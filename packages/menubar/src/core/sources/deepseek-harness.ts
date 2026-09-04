import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import * as zlib from "node:zlib";
import { decompress as fzstdDecompress } from "fzstd";
import { parseDocument } from "yaml";
import { emptyUsage, tryAddUsageInPlace, type ParsedSession, type TokenUsage, type UsageEvent } from "@codex-tracker/shared";
import type { ParseOptions, SessionRoot, SourceContext, SourceDefinition, SourceFile, UserHome } from "./types";
import { isDir, makeRoot, projectNameOf, readUtf8FileLimited, recentSubdirs } from "./util";

const ZSTD_MAGIC = 0xfd2fb528;
const CODEX_OAUTH_PROVIDER = "openai-codex";
const CODEX_UNVERIFIED_PROVIDER = "openai-codex-unverified";
const MAX_FRAME_COMPRESSED_BYTES = 64 * 1024 * 1024;
const MAX_FRAME_OUTPUT_BYTES = 64 * 1024 * 1024;
const STREAM_CHUNK_BYTES = 64 * 1024;
const MAX_STREAM_LINE_BYTES = 16 * 1024 * 1024;

type ZstdRuntime = {
  zstdDecompressSync?: (buffer: Uint8Array, options?: { maxOutputLength?: number }) => Uint8Array;
};

interface DshHeader {
  type?: string;
  version?: number;
  id?: string;
  createdAt?: number;
  cwd?: string;
  seedLength?: number;
}

interface DshUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  reasoningTokens?: number;
}

interface DshMessageSource {
  kind?: string;
  provider?: string;
  model?: string;
}

interface DshRecord {
  type?: string;
  seq?: number;
  time?: number;
  data?: {
    turn?: number;
    step?: number;
    chunk?: {
      type?: string;
      usage?: DshUsage;
    };
    header?: {
      config?: {
        provider?: string;
        model?: string;
      };
    };
    message?: {
      role?: string;
      source?: DshMessageSource;
    };
    usage?: DshUsage;
  };
}

type DshAuthKind = "oauth" | "api-key" | "unknown";
type DshRoot = SessionRoot & { dshHome?: string };

interface ZstdFrameRange {
  start: number;
  end: number;
  contentSize: number | null;
  checksum: number | null;
}

/** `$DSH_HOME` for the local user, otherwise the conventional home-local path. */
function dshHome(h: UserHome, env: NodeJS.ProcessEnv): string {
  const configured = h.origin === "local" ? env.DSH_HOME?.trim() : undefined;
  if (!configured) return path.join(h.home, ".dsh");
  if (configured === "~") return h.home;
  if (/^~[\\/]/.test(configured)) return path.resolve(h.home, configured.slice(2));
  return path.resolve(configured);
}

type YamlLookup =
  | { state: "missing" | "invalid" }
  | { state: "found"; value: unknown };

/** Read and retain only one non-secret discriminator from a local YAML document. */
function yamlLookup(file: string, keys: string[]): YamlLookup {
  let text: string;
  try {
    text = readUtf8FileLimited(file);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR" ? { state: "missing" } : { state: "invalid" };
  }
  try {
    const document = parseDocument(text, { prettyErrors: false, uniqueKeys: true });
    if (document.errors.length) return { state: "invalid" };
    const value = document.getIn(keys);
    return value === undefined ? { state: "missing" } : { state: "found", value };
  } catch {
    return { state: "invalid" };
  }
}

const authCache = new Map<string, { sidecars: string; kind: DshAuthKind }>();

function sidecarVersion(file: string): string {
  try {
    const stat = fs.statSync(file);
    return `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unreadable";
  }
}

function dshAuthKind(root: DshRoot): DshAuthKind {
  if (!root.dshHome) {
    root.oauthAttribution = "unknown";
    return "unknown";
  }
  const settingsFile = path.join(root.dshHome, "settings.yaml");
  const credentialsFile = path.join(root.dshHome, ".credentials.yaml");
  const sidecars = `${sidecarVersion(settingsFile)}|${sidecarVersion(credentialsFile)}`;
  const cached = authCache.get(root.dshHome);
  if (cached?.sidecars === sidecars) {
    root.oauthAttribution = cached.kind === "api-key" ? "non-oauth" : cached.kind;
    return cached.kind;
  }

  const configuredKey = yamlLookup(
    settingsFile,
    ["llm-pi-ai", "providers", CODEX_OAUTH_PROVIDER, "apiKeyEnv"],
  );
  if (configuredKey.state === "invalid") {
    root.oauthAttribution = "unknown";
    throw new Error("Invalid or unreadable DeepSeek Harness settings metadata");
  }
  let kind: DshAuthKind = "unknown";
  if (configuredKey.state === "found") {
    kind = "api-key";
  } else {
    const credentialKind = yamlLookup(
      credentialsFile,
      ["records", `llm-pi-ai/${CODEX_OAUTH_PROVIDER}`, "kind"],
    );
    if (credentialKind.state === "invalid") {
      root.oauthAttribution = "unknown";
      throw new Error("Invalid or unreadable DeepSeek Harness credential metadata");
    }
    if (credentialKind.state === "found" && credentialKind.value === "grant") kind = "oauth";
    else if (credentialKind.state === "found" && credentialKind.value === "api-key") kind = "api-key";
  }
  authCache.set(root.dshHome, { sidecars, kind });
  root.oauthAttribution = kind === "api-key" ? "non-oauth" : kind;
  return kind;
}

function readFrameBytes(fd: number, fileSize: number, offset: number, length: number, message: string): Buffer {
  if (length < 0 || offset < 0 || offset + length > fileSize) throw new Error(message);
  const bytes = Buffer.allocUnsafe(length);
  let read = 0;
  while (read < length) {
    const count = fs.readSync(fd, bytes, read, length - read, offset + read);
    if (count === 0) throw new Error(message);
    read += count;
  }
  return bytes;
}

/** Locate one standard Zstandard frame without loading the rest of a long append-only DSH log. */
function scanZstdFrame(fd: number, fileSize: number, start: number): ZstdFrameRange {
  let offset = start;
  const magic = readFrameBytes(fd, fileSize, offset, 4, "incomplete Zstandard frame magic");
  if (magic.readUInt32LE(0) !== ZSTD_MAGIC) throw new Error(`invalid Zstandard frame magic at byte ${offset}`);
  offset += 4;

  const descriptor = readFrameBytes(fd, fileSize, offset, 1, "incomplete Zstandard frame header").readUInt8(0);
  offset++;
  if ((descriptor & 0x18) !== 0) throw new Error("reserved Zstandard frame-header bit");

  const contentSizeFlag = descriptor >>> 6;
  const singleSegment = (descriptor & 0x20) !== 0;
  const hasChecksum = (descriptor & 0x04) !== 0;
  const dictionaryFlag = descriptor & 0x03;
  const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag;
  const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag;
  const headerBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes;
  const header = readFrameBytes(fd, fileSize, offset, headerBytes, "incomplete Zstandard frame header");
  let contentSize: number | null = null;
  const contentSizeOffset = (singleSegment ? 0 : 1) + dictionaryBytes;
  if (contentSizeBytes === 1) contentSize = header.readUInt8(contentSizeOffset);
  else if (contentSizeBytes === 2) contentSize = header.readUInt16LE(contentSizeOffset) + 256;
  else if (contentSizeBytes === 4) contentSize = header.readUInt32LE(contentSizeOffset);
  else if (contentSizeBytes === 8) {
    const size = header.readBigUInt64LE(contentSizeOffset);
    contentSize = size <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(size) : Number.MAX_SAFE_INTEGER;
  }
  offset += headerBytes;

  for (;;) {
    const block = readFrameBytes(fd, fileSize, offset, 3, "incomplete Zstandard block header");
    const blockHeader = block.readUIntLE(0, 3);
    offset += 3;
    const lastBlock = (blockHeader & 1) !== 0;
    const blockType = (blockHeader >>> 1) & 0x03;
    const blockSize = blockHeader >>> 3;
    if (blockType === 0x03) throw new Error("reserved Zstandard block type");
    const payloadBytes = blockType === 0x01 ? 1 : blockSize;
    if (payloadBytes < 0 || offset + payloadBytes > fileSize) throw new Error("incomplete Zstandard block payload");
    offset += payloadBytes;
    if (lastBlock) break;
  }

  let checksum: number | null = null;
  if (hasChecksum) {
    checksum = readFrameBytes(fd, fileSize, offset, 4, "incomplete Zstandard checksum").readUInt32LE(0);
    offset += 4;
  }
  if (offset - start > MAX_FRAME_COMPRESSED_BYTES) throw new Error("DeepSeek Harness frame exceeds the compressed-size limit");
  return { start, end: offset, contentSize, checksum };
}

const MASK_64 = (1n << 64n) - 1n;
const XXH_PRIME_1 = 11_400_714_785_074_694_791n;
const XXH_PRIME_2 = 14_029_467_366_897_019_727n;
const XXH_PRIME_3 = 1_609_587_929_392_839_161n;
const XXH_PRIME_4 = 9_650_029_242_287_828_579n;
const XXH_PRIME_5 = 2_870_177_450_012_600_261n;

function u64(value: bigint): bigint {
  return value & MASK_64;
}

function rotateLeft64(value: bigint, bits: bigint): bigint {
  return u64((value << bits) | (value >> (64n - bits)));
}

function xxhRound(accumulator: bigint, lane: bigint): bigint {
  return u64(rotateLeft64(u64(accumulator + u64(lane * XXH_PRIME_2)), 31n) * XXH_PRIME_1);
}

/** Zstandard frame checksums are the low 32 bits of XXH64 over decoded content. */
function xxh64Low32(input: Uint8Array): number {
  const bytes = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  let offset = 0;
  let hash: bigint;
  if (bytes.length >= 32) {
    let v1 = u64(XXH_PRIME_1 + XXH_PRIME_2);
    let v2 = XXH_PRIME_2;
    let v3 = 0n;
    let v4 = u64(-XXH_PRIME_1);
    const limit = bytes.length - 32;
    while (offset <= limit) {
      v1 = xxhRound(v1, bytes.readBigUInt64LE(offset)); offset += 8;
      v2 = xxhRound(v2, bytes.readBigUInt64LE(offset)); offset += 8;
      v3 = xxhRound(v3, bytes.readBigUInt64LE(offset)); offset += 8;
      v4 = xxhRound(v4, bytes.readBigUInt64LE(offset)); offset += 8;
    }
    hash = u64(rotateLeft64(v1, 1n) + rotateLeft64(v2, 7n) + rotateLeft64(v3, 12n) + rotateLeft64(v4, 18n));
    for (const lane of [v1, v2, v3, v4]) hash = u64((hash ^ xxhRound(0n, lane)) * XXH_PRIME_1 + XXH_PRIME_4);
  } else {
    hash = XXH_PRIME_5;
  }
  hash = u64(hash + BigInt(bytes.length));
  while (offset + 8 <= bytes.length) {
    hash ^= xxhRound(0n, bytes.readBigUInt64LE(offset));
    hash = u64(rotateLeft64(hash, 27n) * XXH_PRIME_1 + XXH_PRIME_4);
    offset += 8;
  }
  if (offset + 4 <= bytes.length) {
    hash ^= u64(BigInt(bytes.readUInt32LE(offset)) * XXH_PRIME_1);
    hash = u64(rotateLeft64(hash, 23n) * XXH_PRIME_2 + XXH_PRIME_3);
    offset += 4;
  }
  while (offset < bytes.length) {
    hash ^= u64(BigInt(bytes[offset++]) * XXH_PRIME_5);
    hash = u64(rotateLeft64(hash, 11n) * XXH_PRIME_1);
  }
  hash ^= hash >> 33n;
  hash = u64(hash * XXH_PRIME_2);
  hash ^= hash >> 29n;
  hash = u64(hash * XXH_PRIME_3);
  hash ^= hash >> 32n;
  return Number(hash & 0xffff_ffffn);
}

function decompressFrame(frame: Uint8Array, contentSize: number | null): Uint8Array {
  if (contentSize === null || contentSize > MAX_FRAME_OUTPUT_BYTES) {
    throw new Error("unsupported or oversized Zstandard frame output");
  }
  const native = process.env.CODEX_TRACKER_FORCE_FZSTD === "1"
    ? undefined
    : (zlib as unknown as ZstdRuntime).zstdDecompressSync;
  const output = native
    ? native(frame, { maxOutputLength: MAX_FRAME_OUTPUT_BYTES })
    : fzstdDecompress(frame);
  if (output.byteLength !== contentSize || output.byteLength > MAX_FRAME_OUTPUT_BYTES) {
    throw new Error("invalid Zstandard frame content size");
  }
  return output;
}

function compressedChunks(filePath: string): Iterable<string> {
  return {
    *[Symbol.iterator]() {
      const fd = fs.openSync(filePath, "r");
      try {
        const fileSize = fs.fstatSync(fd).size;
        if (fileSize === 0) throw new Error("empty DeepSeek Harness compressed log");
        let offset = 0;
        while (offset < fileSize) {
          const frame = scanZstdFrame(fd, fileSize, offset);
          const encoded = readFrameBytes(
            fd,
            fileSize,
            frame.start,
            frame.end - frame.start,
            "incomplete Zstandard frame",
          );
          const output = decompressFrame(encoded, frame.contentSize);
          if (frame.checksum !== null && xxh64Low32(output) !== frame.checksum) {
            throw new Error("invalid Zstandard frame checksum");
          }
          yield Buffer.from(output).toString("utf8");
          offset = frame.end;
        }
      } finally {
        fs.closeSync(fd);
      }
    },
  };
}

function safeCount(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function usageFrom(record: DshUsage | undefined): TokenUsage | null {
  if (!record) return null;
  const uncached = safeCount(record.inputTokens);
  const output = safeCount(record.outputTokens);
  if (uncached === null || output === null) return null;
  const hasCacheRead = record.cacheReadTokens !== undefined;
  const hasCacheWrite = record.cacheWriteTokens !== undefined;
  const cached = record.cacheReadTokens === undefined ? 0 : safeCount(record.cacheReadTokens);
  const cacheWrite = record.cacheWriteTokens === undefined ? 0 : safeCount(record.cacheWriteTokens);
  const reasoning = record.reasoningTokens === undefined ? 0 : safeCount(record.reasoningTokens);
  const reportedTotal = record.totalTokens === undefined ? undefined : safeCount(record.totalTokens);
  if (cached === null || cacheWrite === null || reasoning === null || reportedTotal === null || reasoning > output) return null;
  const componentInput = uncached + cached + cacheWrite;
  const componentTotal = componentInput + output;
  if (!Number.isSafeInteger(componentInput) || !Number.isSafeInteger(componentTotal)) return null;
  if (reportedTotal !== undefined && reportedTotal < componentTotal) return null;
  if (reportedTotal !== undefined && hasCacheRead && hasCacheWrite && reportedTotal !== componentTotal) return null;
  const input = reportedTotal === undefined ? componentInput : Math.max(componentInput, reportedTotal - output);
  if (!Number.isSafeInteger(input)) return null;
  return {
    input,
    cached,
    cacheWrite,
    output,
    reasoning,
    total: reportedTotal ?? input + output,
    requests: 1,
  };
}

function timestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function createDshRecordParser(file: Omit<SourceFile, "text">, opts: ParseOptions) {
  const state: { header: DshHeader | null } = { header: null };
  let lineCount = 0;
  let lastActivityAt = 0;
  let model = "unknown";
  let provider: string | null = null;
  let requestSource: DshMessageSource | null = null;
  let lastAttempt: { turn: number; step: number; eventIndex: number | null } | null = null;
  const events: UsageEvent[] = [];
  const authKind = dshAuthKind(file.root as DshRoot);

  const includeProvider = (candidate: string): boolean =>
    opts.includeAllProviders || (candidate === CODEX_OAUTH_PROVIDER && authKind === "oauth");

  const sample = (
    turnValue: unknown,
    stepValue: unknown,
    rawUsage: DshUsage | undefined,
    source: DshMessageSource | null | undefined,
    eventTime: number,
  ): void => {
    const turn = safeCount(turnValue);
    const step = safeCount(stepValue);
    const usage = usageFrom(rawUsage);
    if (turn === null || step === null || !usage || typeof source?.provider !== "string") return;
    const sameAttempt = lastAttempt?.turn === turn && lastAttempt.step === step;
    const included = includeProvider(source.provider);
    let eventIndex: number | null = null;
    if (included) {
      const nextModel = typeof source.model === "string" && source.model ? source.model : "unknown";
      const eventProvider = source.provider === CODEX_OAUTH_PROVIDER && authKind !== "oauth"
        ? CODEX_UNVERIFIED_PROVIDER
        : source.provider;
      const event: UsageEvent = {
        ts: eventTime,
        model: nextModel,
        agent: file.root.agent,
        provider: eventProvider,
        usage,
      };
      if (sameAttempt && lastAttempt?.eventIndex !== null && lastAttempt?.eventIndex !== undefined) {
        eventIndex = lastAttempt.eventIndex;
        events[eventIndex] = event;
      } else {
        eventIndex = events.length;
        events.push(event);
      }
      model = nextModel;
      provider = eventProvider;
    } else if (sameAttempt && lastAttempt?.eventIndex !== null && lastAttempt?.eventIndex !== undefined) {
      events.splice(lastAttempt.eventIndex, 1);
    }
    lastAttempt = { turn, step, eventIndex };
  };

  const consume = (line: string): void => {
    if (!line.trim()) return;
    lineCount++;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      throw new Error(`invalid DeepSeek Harness JSONL record at line ${lineCount}`);
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error(`invalid DeepSeek Harness JSONL record at line ${lineCount}`);
    }

    if (!state.header) {
      const candidate = parsed as DshHeader;
      if (
        candidate.type !== "session"
        || candidate.version !== 0
        || typeof candidate.id !== "string"
        || !candidate.id
        || timestamp(candidate.createdAt) === null
      ) {
        throw new Error("invalid DeepSeek Harness session header");
      }
      state.header = candidate;
      lastActivityAt = candidate.createdAt!;
      return;
    }

    const record = parsed as DshRecord;
    if (
      typeof state.header.seedLength === "number"
      && typeof record.seq === "number"
      && record.seq < state.header.seedLength
    ) return;
    const recordTime = timestamp(record.time);
    if (recordTime !== null && recordTime > lastActivityAt) lastActivityAt = recordTime;
    if (record.type === "request/header") {
      requestSource = null;
      const config = record.data?.header?.config;
      if (typeof config?.provider === "string" && typeof config.model === "string") {
        requestSource = { kind: "model", provider: config.provider, model: config.model };
      }
      return;
    }
    if (record.type === "llm/retry-started") {
      const turn = safeCount(record.data?.turn);
      const step = safeCount(record.data?.step);
      if (turn !== null && step !== null && lastAttempt?.turn === turn && lastAttempt.step === step) lastAttempt = null;
      return;
    }
    if (record.type === "assistant/chunk" && record.data?.chunk?.type === "usage") {
      sample(record.data.turn, record.data.step, record.data.chunk.usage, requestSource, recordTime ?? lastActivityAt);
      return;
    }
    if (record.type !== "assistant/message") return;
    // Prompts and generated content are deliberately never accessed or retained.
    const message = record.data?.message;
    const source = message?.source;
    if (message?.role !== "assistant" || source?.kind !== "model") return;
    sample(record.data?.turn, record.data?.step, record.data?.usage, source, recordTime ?? lastActivityAt);
  };

  return {
    consume,
    result(): ParsedSession | null {
      const finalHeader = state.header;
      if (!finalHeader) return null;
      const createdAt = timestamp(finalHeader.createdAt) ?? 0;
      const cwd = typeof finalHeader.cwd === "string" ? finalHeader.cwd : null;
      const cumulative = emptyUsage();
      for (const event of events) if (!tryAddUsageInPlace(cumulative, event.usage)) return null;
      return {
        sessionId: finalHeader.id!,
        agent: file.root.agent,
        provider,
        startedAt: createdAt,
        lastActivityAt: Math.max(createdAt, lastActivityAt),
        cwd,
        projectName: projectNameOf(cwd),
        originator: "dsh",
        source: "dsh",
        cliVersion: null,
        timezone: null,
        model,
        events,
        cumulative,
        contextWindow: null,
        rateLimits: null,
        lineCount,
      };
    },
  };
}

class DshLineBuffer {
  private parts: string[] = [];
  private bytes = 0;

  append(part: string): void {
    if (!part) return;
    this.bytes += Buffer.byteLength(part, "utf8");
    if (this.bytes > MAX_STREAM_LINE_BYTES) {
      throw new Error("DeepSeek Harness JSONL record exceeds the streaming line-size limit");
    }
    this.parts.push(part);
  }

  emit(consume: (line: string) => void): void {
    const joined = this.parts.length === 1 ? this.parts[0] : this.parts.join("");
    this.parts = [];
    this.bytes = 0;
    consume(joined.endsWith("\r") ? joined.slice(0, -1) : joined);
  }
}

function parseDsh(file: SourceFile, opts: ParseOptions): ParsedSession | null {
  const chunks: Iterable<string> = file.path.endsWith(".zstd")
    ? compressedChunks(file.path)
    : [file.text];
  const parser = createDshRecordParser(file, opts);
  const line = new DshLineBuffer();
  for (const chunk of chunks) {
    let start = 0;
    for (;;) {
      const newline = chunk.indexOf("\n", start);
      if (newline === -1) {
        line.append(chunk.slice(start));
        break;
      }
      line.append(chunk.slice(start, newline));
      line.emit(parser.consume);
      start = newline + 1;
    }
  }
  // DSH commits newline-terminated records. A non-empty tail can be a raw-log
  // append in progress, so it is not parsed as durable usage.
  return parser.result();
}

async function parseDshPath(file: Omit<SourceFile, "text">, opts: ParseOptions): Promise<ParsedSession | null> {
  // Compressed roots are parsed synchronously frame-by-frame; SessionStore only calls parsePath for text roots.
  if (file.path.endsWith(".zstd")) return parseDsh({ ...file, text: "" }, opts);

  const parser = createDshRecordParser(file, opts);
  const input = fs.createReadStream(file.path, { encoding: "utf8", highWaterMark: STREAM_CHUNK_BYTES });
  const line = new DshLineBuffer();

  try {
    for await (const value of input) {
      const chunk = String(value);
      let start = 0;
      for (;;) {
        const newline = chunk.indexOf("\n", start);
        if (newline === -1) {
          line.append(chunk.slice(start));
          break;
        }
        line.append(chunk.slice(start, newline));
        line.emit(parser.consume);
        start = newline + 1;
      }
    }
  } finally {
    input.destroy();
  }
  // Match parseDsh: an unterminated final record is not committed and is ignored.
  return parser.result();
}

/** DeepSeek Harness session logs under `$DSH_HOME/sessions` (default `~/.dsh/sessions`). */
export const deepseekHarnessSource: SourceDefinition = {
  id: "dsh",
  label: "DeepSeek Harness",
  format: "dsh",
  discover(ctx: SourceContext): SessionRoot[] {
    const roots: SessionRoot[] = [];
    for (const h of ctx.homes) {
      const home = dshHome(h, ctx.env);
      const sessions = path.join(home, "sessions");
      if (!isDir(sessions)) continue;
      const plaintext = makeRoot(sessions, "dsh", "dsh", "dsh", "flat", h.origin, ["session.jsonl"], 2) as DshRoot;
      const compressed = makeRoot(sessions, "dsh", "dsh", "dsh", "flat", h.origin, ["session.jsonl.zstd"], 2, false) as DshRoot;
      plaintext.dshHome = home;
      compressed.dshHome = home;
      roots.push(plaintext, compressed);
    }
    return roots;
  },
  hotDirs(root: SessionRoot): string[] {
    const projects = recentSubdirs(root.dir);
    return [root.dir, ...projects, ...projects.flatMap((project) => recentSubdirs(project))];
  },
  watchRecursively: () => true,
  fileVersion: (_file, stat, root) => {
    const auth = dshAuthKind(root as DshRoot);
    const discriminator = auth === "oauth" ? 1 : auth === "api-key" ? 2 : 3;
    return { size: stat.size * 4 + discriminator, mtimeMs: stat.mtimeMs };
  },
  parsePath: parseDshPath,
  parse: parseDsh,
  extraRoot: (dir, agent) => {
    const root = makeRoot(dir, "dsh", agent, "dsh", "extra", "extra", ["session.jsonl", "session.jsonl.zstd"], 2) as DshRoot;
    root.dshHome = dshHome({ home: os.homedir(), origin: "local", layout: process.platform === "darwin" ? "darwin" : process.platform === "win32" ? "win32" : "linux" }, process.env);
    return root;
  },
};
