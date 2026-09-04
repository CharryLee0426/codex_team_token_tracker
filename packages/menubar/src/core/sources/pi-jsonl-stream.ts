import fs from "node:fs";

const READ_CHUNK_BYTES = 64 * 1024;
const MAX_CAPTURED_STRING_CHARS = 64 * 1024;
const MAX_JSON_DEPTH = 256;

type JsonPunctuation = "{" | "}" | "[" | "]" | ":" | ",";
type JsonToken =
  | { kind: "punctuation"; value: JsonPunctuation }
  | { kind: "string"; value: string | undefined }
  | { kind: "number"; value: number }
  | { kind: "literal"; value: boolean | null };
type JsonLineToken = JsonToken | { kind: "eol" } | { kind: "invalid" };

const PUNCTUATION = new Set(["{", "}", "[", "]", ":", ","]);
const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;
const USAGE_FIELDS = new Set([
  "input",
  "output",
  "cacheRead",
  "cacheWrite",
  "reasoning",
  "reasoningTokens",
  "totalTokens",
]);

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\r";
}

function isTokenBoundary(char: string): boolean {
  return char === "\n" || isWhitespace(char) || PUNCTUATION.has(char);
}

function numberToken(raw: string): JsonToken {
  if (!NUMBER_RE.test(raw)) throw new Error("Invalid JSON number");
  return { kind: "number", value: Number(raw) };
}

function literalToken(raw: string): JsonToken {
  if (raw === "true") return { kind: "literal", value: true };
  if (raw === "false") return { kind: "literal", value: false };
  if (raw === "null") return { kind: "literal", value: null };
  throw new Error("Invalid JSON literal");
}

/** Tokenize independent JSONL records while bounding every retained string. */
async function* tokenizeJsonLines(filePath: string): AsyncGenerator<JsonLineToken> {
  const input = fs.createReadStream(filePath, { encoding: "utf8", highWaterMark: READ_CHUNK_BYTES });
  let mode: "value" | "string" | "number" | "literal" | "discard" = "value";
  let raw = "";
  let truncated = false;
  let escaped = false;
  let unicodeDigits = 0;

  const appendStringChar = (char: string): void => {
    if (truncated) return;
    if (raw.length + char.length <= MAX_CAPTURED_STRING_CHARS) raw += char;
    else {
      raw = "";
      truncated = true;
    }
  };

  const resetScalar = (): void => {
    raw = "";
    truncated = false;
    escaped = false;
    unicodeDigits = 0;
  };

  try {
    for await (const chunk of input) {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (let index = 0; index < text.length; index++) {
        const char = text[index];

        if (mode === "discard") {
          if (char === "\n") {
            mode = "value";
            resetScalar();
            yield { kind: "eol" };
          }
          continue;
        }

        if (mode === "string") {
          if (char === "\n") {
            yield { kind: "invalid" };
            yield { kind: "eol" };
            mode = "value";
            resetScalar();
            continue;
          }
          if (unicodeDigits > 0) {
            if (!/[0-9a-f]/i.test(char)) {
              yield { kind: "invalid" };
              mode = "discard";
              resetScalar();
              continue;
            }
            appendStringChar(char);
            unicodeDigits--;
            continue;
          }
          if (escaped) {
            if (char === "u") unicodeDigits = 4;
            else if (!'"\\/bfnrt'.includes(char)) {
              yield { kind: "invalid" };
              mode = "discard";
              resetScalar();
              continue;
            }
            appendStringChar(char);
            escaped = false;
            continue;
          }
          if (char === "\\") {
            appendStringChar(char);
            escaped = true;
            continue;
          }
          if (char === '"') {
            appendStringChar(char);
            let value: string | undefined;
            try {
              value = truncated ? undefined : JSON.parse(raw) as string;
            } catch {
              yield { kind: "invalid" };
              mode = "discard";
              resetScalar();
              continue;
            }
            yield { kind: "string", value };
            mode = "value";
            resetScalar();
            continue;
          }
          if (char.charCodeAt(0) < 0x20) {
            yield { kind: "invalid" };
            mode = "discard";
            resetScalar();
            continue;
          }
          appendStringChar(char);
          continue;
        }

        if (mode === "number" || mode === "literal") {
          if (!isTokenBoundary(char)) {
            raw += char;
            if (raw.length > 128) {
              yield { kind: "invalid" };
              mode = "discard";
              resetScalar();
            }
            continue;
          }
          let token: JsonToken;
          try {
            token = mode === "number" ? numberToken(raw) : literalToken(raw);
          } catch {
            yield { kind: "invalid" };
            mode = char === "\n" ? "value" : "discard";
            resetScalar();
            if (char === "\n") yield { kind: "eol" };
            continue;
          }
          yield token;
          mode = "value";
          resetScalar();
          index--;
          continue;
        }

        if (char === "\n") {
          yield { kind: "eol" };
        } else if (isWhitespace(char)) {
          continue;
        } else if (PUNCTUATION.has(char)) {
          yield { kind: "punctuation", value: char as JsonPunctuation };
        } else if (char === '"') {
          mode = "string";
          raw = '"';
          truncated = false;
          escaped = false;
          unicodeDigits = 0;
        } else if (char === "-" || /[0-9]/.test(char)) {
          mode = "number";
          raw = char;
        } else if (/[tfn]/.test(char)) {
          mode = "literal";
          raw = char;
        } else {
          yield { kind: "invalid" };
          mode = "discard";
          resetScalar();
        }
      }
    }

    if (mode === "string") yield { kind: "invalid" };
    else if (mode === "number" || mode === "literal") {
      try {
        yield mode === "number" ? numberToken(raw) : literalToken(raw);
      } catch {
        yield { kind: "invalid" };
      }
    }
  } finally {
    input.destroy();
  }
}

class TokenCursor {
  private buffered: JsonLineToken | null | undefined;

  constructor(private readonly tokens: AsyncIterator<JsonLineToken>) {}

  async peek(): Promise<JsonLineToken | null> {
    if (this.buffered === undefined) {
      const next = await this.tokens.next();
      this.buffered = next.done ? null : next.value;
    }
    return this.buffered;
  }

  async take(): Promise<JsonToken> {
    const token = await this.peek();
    if (!token) throw new Error("Unexpected end of JSON input");
    if (token.kind === "eol" || token.kind === "invalid") throw new Error("Invalid JSON input");
    this.buffered = undefined;
    return token;
  }

  async takeLineToken(): Promise<JsonLineToken> {
    const token = await this.peek();
    if (!token) throw new Error("Unexpected end of JSON input");
    this.buffered = undefined;
    return token;
  }

  async accept(value: JsonPunctuation): Promise<boolean> {
    const token = await this.peek();
    if (token?.kind !== "punctuation" || token.value !== value) return false;
    await this.take();
    return true;
  }

  async expect(value: JsonPunctuation): Promise<void> {
    if (!await this.accept(value)) throw new Error(`Expected ${value} in JSON input`);
  }

  async discardLine(): Promise<void> {
    for (;;) {
      const token = await this.peek();
      if (!token) return;
      await this.takeLineToken();
      if (token.kind === "eol") return;
    }
  }
}

async function skipValue(cursor: TokenCursor, depth = 0): Promise<void> {
  if (depth > MAX_JSON_DEPTH) throw new Error("JSON nesting is too deep");
  const token = await cursor.take();
  if (token.kind !== "punctuation") return;
  if (token.value !== "{" && token.value !== "[") throw new Error("Expected JSON value");

  const closing = token.value === "{" ? "}" : "]";
  if (await cursor.accept(closing)) return;
  for (;;) {
    if (token.value === "{") {
      const key = await cursor.take();
      if (key.kind !== "string") throw new Error("Expected JSON object key");
      await cursor.expect(":");
    }
    await skipValue(cursor, depth + 1);
    if (await cursor.accept(closing)) return;
    await cursor.expect(",");
  }
}

async function readScalar(cursor: TokenCursor): Promise<unknown> {
  const token = await cursor.peek();
  if (token?.kind === "string" || token?.kind === "number" || token?.kind === "literal") {
    await cursor.take();
    return token.value;
  }
  await skipValue(cursor);
  return undefined;
}

async function readObject(
  cursor: TokenCursor,
  visit: (key: string | undefined) => Promise<void>,
): Promise<void> {
  await cursor.expect("{");
  if (await cursor.accept("}")) return;
  for (;;) {
    const key = await cursor.take();
    if (key.kind !== "string") throw new Error("Expected JSON object key");
    await cursor.expect(":");
    await visit(key.value);
    if (await cursor.accept("}")) return;
    await cursor.expect(",");
  }
}

async function readUsage(cursor: TokenCursor): Promise<Record<string, unknown> | undefined> {
  const first = await cursor.peek();
  if (first?.kind !== "punctuation" || first.value !== "{") {
    await skipValue(cursor);
    return undefined;
  }
  const usage: Record<string, unknown> = {};
  await readObject(cursor, async (key) => {
    if (key && USAGE_FIELDS.has(key)) {
      const value = await readScalar(cursor);
      // `undefined` means the JSON value was structurally valid but deliberately not retained
      // (for example an oversized string or object). Keep the field present and invalid so the
      // shared parser cannot reinterpret malformed accounting data as a missing zero counter.
      usage[key] = value === undefined ? null : value;
    } else {
      await skipValue(cursor);
    }
  });
  return usage;
}

async function readMessage(cursor: TokenCursor): Promise<Record<string, unknown> | undefined> {
  const first = await cursor.peek();
  if (first?.kind !== "punctuation" || first.value !== "{") {
    await skipValue(cursor);
    return undefined;
  }
  const message: Record<string, unknown> = {};
  await readObject(cursor, async (key) => {
    if (key === "role" || key === "timestamp" || key === "provider" || key === "api" || key === "model") {
      const value = await readScalar(cursor);
      message[key] = value === undefined ? null : value;
    } else if (key === "usage") {
      message.usage = await readUsage(cursor);
    } else {
      await skipValue(cursor);
    }
  });
  return message;
}

async function readProjectedRecord(cursor: TokenCursor): Promise<Record<string, unknown>> {
  const first = await cursor.peek();
  if (first?.kind !== "punctuation" || first.value !== "{") {
    await skipValue(cursor);
    return {};
  }
  const record: Record<string, unknown> = {};
  await readObject(cursor, async (key) => {
    if (
      key === "type"
      || key === "id"
      || key === "timestamp"
      || key === "cwd"
      || key === "modelId"
      || key === "provider"
      || key === "api"
      || key === "model"
    ) {
      const value = await readScalar(cursor);
      record[key] = value === undefined ? null : value;
    } else if (key === "message") {
      record.message = await readMessage(cursor);
    } else if (key === "usage") {
      record.usage = await readUsage(cursor);
    } else {
      await skipValue(cursor);
    }
  });
  return record;
}

/** Stream Pi/OMP JSONL and pass only accounting metadata to the shared line parser. */
export async function streamProjectedPiJsonl(filePath: string, push: (line: string) => void): Promise<void> {
  const tokens = tokenizeJsonLines(filePath)[Symbol.asyncIterator]();
  const cursor = new TokenCursor(tokens);
  try {
    for (;;) {
      const first = await cursor.peek();
      if (!first) return;
      if (first.kind === "eol") {
        await cursor.takeLineToken();
        continue;
      }
      try {
        const record = await readProjectedRecord(cursor);
        const trailing = await cursor.peek();
        if (trailing?.kind === "eol") await cursor.takeLineToken();
        else if (trailing) throw new Error("Unexpected trailing JSON input");
        push(JSON.stringify(record));
      } catch {
        // The legacy parser counts malformed non-empty lines but otherwise ignores them.
        push("{");
        await cursor.discardLine();
      }
    }
  } finally {
    await tokens.return?.(undefined);
  }
}
