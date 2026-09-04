import fs from "node:fs";

const READ_CHUNK_BYTES = 64 * 1024;
const MAX_CAPTURED_STRING_CHARS = 256 * 1024;
const MAX_METADATA_STRING_CHARS = 4 * 1024;
const MAX_LEGACY_REQUEST_STRING_CHARS = 64 * 1024;
const MAX_JSON_DEPTH = 256;

type JsonPunctuation = "{" | "}" | "[" | "]" | ":" | ",";
type JsonToken =
  | { kind: "punctuation"; value: JsonPunctuation }
  | { kind: "string"; value: string | undefined }
  | { kind: "number"; value: number }
  | { kind: "literal"; value: boolean | null };

export interface StreamedCurrentMessage {
  role?: string;
  ts?: number;
  modelInfo?: {
    id?: string;
    provider?: string;
  };
  metrics?: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
  };
}

export interface StreamedLegacyMessage {
  ts?: number;
  type?: string;
  say?: string;
  text?: string;
}

export interface ClineJsonVisitor {
  /** A later duplicate `messages` property replaces the earlier value, matching JSON.parse. */
  beginCurrentMessages?(): void;
  beginLegacyMessages?(): void;
  currentMessage?(message: StreamedCurrentMessage): void;
  legacyMessage?(message: StreamedLegacyMessage): void;
}

export type StreamedClineJson =
  | {
    kind: "current";
    version?: number;
    updatedAt?: string;
    sessionId?: string;
    hasMessages: boolean;
    lineCount: number;
  }
  | { kind: "legacy"; lineCount: number }
  | { kind: "other" };

const PUNCTUATION = new Set(["{", "}", "[", "]", ":", ","]);
const NUMBER_RE = /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/;

function isWhitespace(char: string): boolean {
  return char === " " || char === "\t" || char === "\r" || char === "\n";
}

function isTokenBoundary(char: string): boolean {
  return isWhitespace(char) || PUNCTUATION.has(char);
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

/** Tokenize JSON while retaining at most a bounded prefix for any one string value. */
async function* tokenizeJson(filePath: string): AsyncGenerator<JsonToken> {
  const input = fs.createReadStream(filePath, { encoding: "utf8", highWaterMark: READ_CHUNK_BYTES });
  let mode: "value" | "string" | "number" | "literal" = "value";
  let raw = "";
  let truncated = false;
  let escaped = false;
  let unicodeDigits = 0;

  const appendStringChar = (char: string) => {
    if (truncated) return;
    if (raw.length + char.length <= MAX_CAPTURED_STRING_CHARS) raw += char;
    else {
      raw = "";
      truncated = true;
    }
  };

  try {
    for await (const chunk of input) {
      const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
      for (let index = 0; index < text.length; index++) {
        const char = text[index];

        if (mode === "string") {
          if (unicodeDigits > 0) {
            if (!/[0-9a-f]/i.test(char)) throw new Error("Invalid JSON unicode escape");
            appendStringChar(char);
            unicodeDigits--;
            continue;
          }
          if (escaped) {
            if (char === "u") unicodeDigits = 4;
            else if (!'"\\/bfnrt'.includes(char)) throw new Error("Invalid JSON escape");
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
            yield {
              kind: "string",
              value: truncated ? undefined : JSON.parse(raw) as string,
            };
            mode = "value";
            raw = "";
            truncated = false;
            continue;
          }
          if (char.charCodeAt(0) < 0x20) throw new Error("Invalid control character in JSON string");
          appendStringChar(char);
          continue;
        }

        if (mode === "number" || mode === "literal") {
          if (!isTokenBoundary(char)) {
            raw += char;
            if (raw.length > 128) throw new Error("Oversized JSON scalar");
            continue;
          }
          yield mode === "number" ? numberToken(raw) : literalToken(raw);
          mode = "value";
          raw = "";
          index--;
          continue;
        }

        if (isWhitespace(char)) continue;
        if (PUNCTUATION.has(char)) {
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
          throw new Error("Invalid JSON token");
        }
      }
    }

    if (mode === "string") throw new Error("Unterminated JSON string");
    if (mode === "number") yield numberToken(raw);
    else if (mode === "literal") yield literalToken(raw);
  } finally {
    input.destroy();
  }
}

class TokenCursor {
  private buffered: JsonToken | null | undefined;

  constructor(private readonly tokens: AsyncIterator<JsonToken>) {}

  async peek(): Promise<JsonToken | null> {
    if (this.buffered === undefined) {
      const next = await this.tokens.next();
      this.buffered = next.done ? null : next.value;
    }
    return this.buffered;
  }

  async take(): Promise<JsonToken> {
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

async function readString(cursor: TokenCursor): Promise<string | undefined> {
  const token = await cursor.peek();
  if (token?.kind === "string") {
    await cursor.take();
    return token.value;
  }
  await skipValue(cursor);
  return undefined;
}

async function readNumber(cursor: TokenCursor): Promise<number | undefined> {
  const token = await cursor.peek();
  if (token?.kind === "number") {
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

async function readArray(
  cursor: TokenCursor,
  visit: () => Promise<void>,
): Promise<void> {
  await cursor.expect("[");
  if (await cursor.accept("]")) return;
  for (;;) {
    await visit();
    if (await cursor.accept("]")) return;
    await cursor.expect(",");
  }
}

async function readSelectedObject(
  cursor: TokenCursor,
  fields: Record<string, "string" | "number">,
): Promise<Record<string, unknown> | undefined> {
  const first = await cursor.peek();
  if (first?.kind !== "punctuation" || first.value !== "{") {
    await skipValue(cursor);
    return undefined;
  }
  const result: Record<string, unknown> = {};
  await readObject(cursor, async (key) => {
    const kind = key ? fields[key] : undefined;
    if (kind === "string") result[key!] = await readString(cursor);
    else if (kind === "number") result[key!] = await readNumber(cursor);
    else await skipValue(cursor);
  });
  return result;
}

function boundedString(value: unknown, maxChars: number): string | undefined {
  return typeof value === "string" && value.length <= maxChars ? value : undefined;
}

async function readCurrentMessage(cursor: TokenCursor): Promise<StreamedCurrentMessage> {
  const first = await cursor.peek();
  if (first?.kind !== "punctuation" || first.value !== "{") {
    await skipValue(cursor);
    return {};
  }
  const message: StreamedCurrentMessage = {};
  await readObject(cursor, async (key) => {
    if (key === "role") message.role = boundedString(await readString(cursor), MAX_METADATA_STRING_CHARS);
    else if (key === "ts") message.ts = await readNumber(cursor);
    else if (key === "modelInfo") {
      const selected = await readSelectedObject(cursor, { id: "string", provider: "string" });
      if (selected) {
        message.modelInfo = {
          id: boundedString(selected.id, MAX_METADATA_STRING_CHARS),
          provider: boundedString(selected.provider, MAX_METADATA_STRING_CHARS),
        };
      }
    } else if (key === "metrics") {
      const selected = await readSelectedObject(cursor, {
        inputTokens: "number",
        outputTokens: "number",
        cacheReadTokens: "number",
        cacheWriteTokens: "number",
      });
      if (selected) {
        message.metrics = {
          inputTokens: typeof selected.inputTokens === "number" ? selected.inputTokens : undefined,
          outputTokens: typeof selected.outputTokens === "number" ? selected.outputTokens : undefined,
          cacheReadTokens: typeof selected.cacheReadTokens === "number" ? selected.cacheReadTokens : undefined,
          cacheWriteTokens: typeof selected.cacheWriteTokens === "number" ? selected.cacheWriteTokens : undefined,
        };
      }
    } else await skipValue(cursor);
  });
  return message;
}

async function readCurrentEnvelope(
  cursor: TokenCursor,
  visitor: ClineJsonVisitor,
): Promise<Extract<StreamedClineJson, { kind: "current" }>> {
  const envelope: Extract<StreamedClineJson, { kind: "current" }> = {
    kind: "current",
    hasMessages: false,
    lineCount: 0,
  };
  await readObject(cursor, async (key) => {
    if (key === "version") envelope.version = await readNumber(cursor);
    else if (key === "updated_at") {
      envelope.updatedAt = boundedString(await readString(cursor), MAX_METADATA_STRING_CHARS);
    } else if (key === "sessionId") {
      envelope.sessionId = boundedString(await readString(cursor), MAX_METADATA_STRING_CHARS);
    } else if (key === "messages") {
      visitor.beginCurrentMessages?.();
      envelope.hasMessages = false;
      envelope.lineCount = 0;
      const first = await cursor.peek();
      if (first?.kind !== "punctuation" || first.value !== "[") {
        await skipValue(cursor);
        return;
      }
      envelope.hasMessages = true;
      await readArray(cursor, async () => {
        const message = await readCurrentMessage(cursor);
        envelope.lineCount++;
        visitor.currentMessage?.(message);
      });
    } else await skipValue(cursor);
  });
  return envelope;
}

async function readLegacyMessages(
  cursor: TokenCursor,
  visitor: ClineJsonVisitor,
): Promise<Extract<StreamedClineJson, { kind: "legacy" }>> {
  let lineCount = 0;
  visitor.beginLegacyMessages?.();
  await readArray(cursor, async () => {
    const selected = await readSelectedObject(cursor, {
      ts: "number",
      type: "string",
      say: "string",
      text: "string",
    });
    const message: StreamedLegacyMessage = selected
      ? {
        ts: typeof selected.ts === "number" ? selected.ts : undefined,
        type: boundedString(selected.type, MAX_METADATA_STRING_CHARS),
        say: boundedString(selected.say, MAX_METADATA_STRING_CHARS),
        text: boundedString(selected.text, MAX_LEGACY_REQUEST_STRING_CHARS),
      }
      : {};
    lineCount++;
    visitor.legacyMessage?.(message);
  });
  return { kind: "legacy", lineCount };
}

/** Read only the Cline fields needed for accounting, discarding large prompt/tool content while streaming. */
export async function readClineJson(
  filePath: string,
  visitor: ClineJsonVisitor = {},
): Promise<StreamedClineJson> {
  const tokens = tokenizeJson(filePath)[Symbol.asyncIterator]();
  const cursor = new TokenCursor(tokens);
  try {
    const first = await cursor.peek();
    if (!first) throw new Error("Empty JSON input");

    let result: StreamedClineJson;
    if (first.kind === "punctuation" && first.value === "{") {
      result = await readCurrentEnvelope(cursor, visitor);
    } else if (first.kind === "punctuation" && first.value === "[") {
      result = await readLegacyMessages(cursor, visitor);
    } else {
      await skipValue(cursor);
      result = { kind: "other" };
    }

    if (await cursor.peek()) throw new Error("Unexpected trailing JSON input");
    return result;
  } finally {
    await tokens.return?.(undefined);
  }
}
