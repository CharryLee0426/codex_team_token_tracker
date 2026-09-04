import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import * as zlib from "node:zlib";
import { Decompress as FzstdDecompress, decompress as fzstdDecompress } from "fzstd";
import { createSessionParser, sessionIdFromFilename, type ParsedSession } from "@codex-tracker/shared";
import type { SessionRoot, SourceContext, SourceDefinition, SourceFile } from "./types";
import { makeRoot, readUtf8FileLimited } from "./util";

const CODEX_EXTENSIONS = [".jsonl", ".jsonl.zst"];
const CODEX_OAUTH_PROVIDER = "openai-codex";
export const MAX_CODEX_JSONL_LINE_BYTES = 16 * 1024 * 1024;

type CodexAuthKind = "oauth" | "non-oauth" | "unknown";
type CodexRoot = SessionRoot & { codexAuthFile?: string };

export type CodexZstdRuntime = {
  createZstdDecompress?: () => NodeJS.ReadWriteStream & { destroy(error?: Error): void };
  zstdDecompressSync?: (buffer: Uint8Array) => Uint8Array;
};

interface SessionLineParser {
  push(line: string): void;
  result(): ParsedSession | null;
}

/** Decode arbitrary byte chunks into bounded JSONL records without retaining transcript content. */
class BoundedJsonlLines {
  private readonly decoder = new StringDecoder("utf8");
  private fragments: string[] = [];
  private bytes = 0;
  private discarding = false;

  constructor(private readonly parser: SessionLineParser) {}

  push(chunk: Uint8Array): void {
    this.consume(this.decoder.write(Buffer.from(chunk)));
  }

  end(): void {
    this.consume(this.decoder.end());
    if (!this.discarding && this.bytes > 0) this.emitLine();
  }

  private consume(text: string): void {
    let start = 0;
    for (;;) {
      const newline = text.indexOf("\n", start);
      if (newline < 0) {
        if (!this.discarding) this.append(text.slice(start));
        return;
      }
      if (!this.discarding) this.append(text.slice(start, newline));
      if (this.discarding) this.resetLine();
      else this.emitLine();
      start = newline + 1;
    }
  }

  private append(value: string): void {
    if (!value) return;
    this.bytes += Buffer.byteLength(value, "utf8");
    if (this.bytes > MAX_CODEX_JSONL_LINE_BYTES) {
      // Rollouts may contain huge prompt/tool response_item records. They contain no usage, so drop
      // just that record and keep scanning for later compact token_usage_record lines.
      this.fragments = [];
      this.bytes = 0;
      this.discarding = true;
      return;
    }
    this.fragments.push(value);
  }

  private emitLine(): void {
    const line = this.fragments.length === 1 ? this.fragments[0] : this.fragments.join("");
    this.resetLine();
    this.parser.push(line);
  }

  private resetLine(): void {
    this.fragments = [];
    this.bytes = 0;
    this.discarding = false;
  }
}

function forRoot(session: ParsedSession | null, root: SessionRoot, auth: CodexAuthKind): ParsedSession | null {
  if (!session) return null;
  const provider = auth === "oauth" ? CODEX_OAUTH_PROVIDER : "unknown";
  return {
    ...session,
    agent: root.agent,
    provider,
    events: session.events.map((event) => ({ ...event, agent: root.agent, provider })),
  };
}

const authCache = new Map<string, { version: string; kind: CodexAuthKind }>();

function sidecarVersion(file: string): string {
  try {
    const stat = fs.statSync(file);
    return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable";
  }
}

function isCodexDirectory(file: string): boolean {
  try {
    return fs.statSync(file).isDirectory();
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return false;
    throw error;
  }
}

/** Read only the auth kind. Credential/token fields are never retained, logged or returned. */
function authKindFromFile(file: string | undefined): CodexAuthKind {
  if (!file) return "unknown";
  const version = sidecarVersion(file);
  const cached = authCache.get(file);
  if (cached?.version === version) return cached.kind;

  let raw: string;
  try {
    raw = readUtf8FileLimited(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw new Error("Unreadable Codex auth metadata");
    authCache.set(file, { version, kind: "unknown" });
    return "unknown";
  }

  let value: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("invalid shape");
    value = parsed as Record<string, unknown>;
  } catch {
    throw new Error("Invalid Codex auth metadata");
  }

  let kind: CodexAuthKind;
  if (Object.prototype.hasOwnProperty.call(value, "auth_mode")) {
    kind = value.auth_mode === "chatgpt" ? "oauth" : "non-oauth";
  } else {
    const apiKey = value.OPENAI_API_KEY != null;
    const hasOtherCredential = value.personal_access_token != null
      || value.agent_identity != null
      || value.bedrock_api_key != null
      || value.bedrock_access_keys != null
      || value.chatgptAuthTokens != null
      || value.headers != null;
    const tokens = value.tokens;
    const tokenRecord = tokens && typeof tokens === "object" && !Array.isArray(tokens)
      ? tokens as Record<string, unknown>
      : null;
    const hasTokens = !!tokenRecord && ["access_token", "refresh_token", "id_token"].some((key) =>
      typeof tokenRecord[key] === "string" && tokenRecord[key].trim().length > 0,
    );
    kind = !apiKey && !hasOtherCredential && hasTokens ? "oauth" : "non-oauth";
  }
  authCache.set(file, { version, kind });
  return kind;
}

function rootAuthKind(root: CodexRoot): CodexAuthKind {
  const kind = authKindFromFile(root.codexAuthFile);
  root.oauthAttribution = kind;
  return kind;
}

/** Attach the auth sidecar belonging to a native Codex home without exposing its contents. */
export function withCodexAuth(root: SessionRoot, home: string): SessionRoot {
  (root as CodexRoot).codexAuthFile = path.join(home, "auth.json");
  rootAuthKind(root as CodexRoot);
  return root;
}

function rolloutText(file: SourceFile): string | null {
  if (!file.path.toLowerCase().endsWith(".jsonl.zst")) return file.text;
  const compressed = fs.readFileSync(file.path);
  const nativeDecompress = (zlib as unknown as CodexZstdRuntime).zstdDecompressSync;
  const decoded = typeof nativeDecompress === "function"
    ? nativeDecompress(compressed)
    : fzstdDecompress(compressed);
  return Buffer.from(decoded).toString("utf8");
}

async function feedReadable(input: NodeJS.ReadableStream, lines: BoundedJsonlLines): Promise<void> {
  try {
    for await (const chunk of input as AsyncIterable<Uint8Array | string>) {
      lines.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    lines.end();
  } finally {
    (input as NodeJS.ReadableStream & { destroy?(): void }).destroy?.();
  }
}

async function feedFzstd(filePath: string, lines: BoundedJsonlLines): Promise<void> {
  const input = fs.createReadStream(filePath);
  const decoder = new FzstdDecompress((chunk) => lines.push(chunk));
  try {
    for await (const chunk of input) decoder.push(chunk as Buffer);
    decoder.push(new Uint8Array(0), true);
    lines.end();
  } finally {
    input.destroy();
  }
}

/** Bounded path parser; the optional runtime argument lets compatibility tests force pure JS. */
export async function parseCodexRolloutPath(
  file: Omit<SourceFile, "text">,
  opts: { includeAllProviders: boolean },
  runtime: CodexZstdRuntime = zlib as unknown as CodexZstdRuntime,
): Promise<ParsedSession | null> {
  const auth = rootAuthKind(file.root as CodexRoot);
  if (auth !== "oauth" && !opts.includeAllProviders) return null;
  const parser = createSessionParser(sessionIdFromFilename(file.path));
  const lines = new BoundedJsonlLines(parser);

  if (file.path.toLowerCase().endsWith(".jsonl.zst")) {
    const nativeDecompress = runtime.createZstdDecompress;
    if (typeof nativeDecompress === "function") {
      const source = fs.createReadStream(file.path);
      const decoder = nativeDecompress();
      source.once("error", (error) => decoder.destroy(error));
      decoder.once("error", () => source.destroy());
      await feedReadable(source.pipe(decoder), lines);
    } else {
      await feedFzstd(file.path, lines);
    }
  } else {
    await feedReadable(fs.createReadStream(file.path), lines);
  }
  return forRoot(parser.result(), file.root, auth);
}

export function codexHome(): string {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

/** `<home>/<rel…>`, honoring an env override only for the machine's own home directory. */
function underHome(h: { home: string }, envVar: string | undefined, ...rel: string[]): string {
  if (envVar && h.home === os.homedir()) return envVar;
  return path.join(h.home, ...rel);
}


function dateDirs(root: string): string[] {
  const dirs: string[] = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  for (const offset of [0, -1]) {
    const d = new Date();
    d.setDate(d.getDate() + offset);
    dirs.push(path.join(root, String(d.getFullYear()), pad(d.getMonth() + 1), pad(d.getDate())));
  }
  const u = new Date();
  dirs.push(path.join(root, String(u.getUTCFullYear()), pad(u.getUTCMonth() + 1), pad(u.getUTCDate())));
  return [...new Set(dirs)];
}

/** Codex CLI / Codex Desktop rollouts: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl[.zst] and ~/.codex/archived_sessions. */
export const codexSource: SourceDefinition = {
  id: "codex",
  label: "Codex CLI / Desktop",
  format: "codex",
  discover(ctx: SourceContext): SessionRoot[] {
    const roots: SessionRoot[] = [];
    for (const h of ctx.homes) {
      const home = underHome(h, ctx.env.CODEX_HOME, ".codex");
      const sessions = path.join(home, "sessions");
      const archived = path.join(home, "archived_sessions");
      if (isCodexDirectory(sessions)) roots.push(withCodexAuth(makeRoot(sessions, "codex", "codex", "codex", "sessions", h.origin, [...CODEX_EXTENSIONS]), home));
      if (isCodexDirectory(archived)) roots.push(withCodexAuth(makeRoot(archived, "codex", "codex", "codex", "archived", h.origin, [...CODEX_EXTENSIONS], 1), home));
    }
    return roots;
  },
  hotDirs(root: SessionRoot): string[] {
    return root.kind === "sessions" || root.kind === "extra" ? [root.dir, ...dateDirs(root.dir)] : [root.dir];
  },
  watchRecursively: () => false,
  fileVersion(file, stat, root) {
    const auth = rootAuthKind(root as CodexRoot);
    const authVersion = (root as CodexRoot).codexAuthFile ? sidecarVersion((root as CodexRoot).codexAuthFile!) : "missing";
    let fingerprint = auth === "oauth" ? 1 : auth === "non-oauth" ? 2 : 3;
    for (const char of authVersion) fingerprint = (Math.imul(fingerprint, 33) ^ char.charCodeAt(0)) >>> 0;
    return { size: stat.size + fingerprint, mtimeMs: stat.mtimeMs };
  },
  parsePath: parseCodexRolloutPath,
  preferParsePath: (file) => file.toLowerCase().endsWith(".jsonl.zst"),
  parse(file: SourceFile, opts) {
    const auth = rootAuthKind(file.root as CodexRoot);
    if (auth !== "oauth" && !opts.includeAllProviders) return null;
    const text = rolloutText(file);
    if (text === null) return null;
    const parser = createSessionParser(sessionIdFromFilename(file.path));
    for (const line of text.split(/\r?\n/)) parser.push(line);
    return forRoot(parser.result(), file.root, auth);
  },
  extraRoot(dir, agent) {
    const normalized = path.resolve(dir);
    let home = codexHome();
    for (let current = normalized, depth = 0; depth < 8; depth++, current = path.dirname(current)) {
      if (["sessions", "archived_sessions"].includes(path.basename(current))) {
        home = path.dirname(current);
        break;
      }
      if (path.dirname(current) === current) break;
    }
    return withCodexAuth(makeRoot(dir, "codex", agent, "codex", "extra", "extra", [...CODEX_EXTENSIONS]), home);
  },
};
