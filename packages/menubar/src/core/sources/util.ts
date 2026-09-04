import fs from "node:fs";
import path from "node:path";
import { tryAddUsageInPlace, type ParsedSession } from "@codex-tracker/shared";
import type { RootKind, RootOrigin, SessionRoot } from "./types";
import type { SourceFormat } from "../config";

export const TWO_DAYS = 2 * 86_400_000;
export const MAX_AUTH_METADATA_BYTES = 2 * 1024 * 1024;

function isMissingPathError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

export function isDir(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

export function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch (error) {
    if (isMissingPathError(error)) return false;
    throw error;
  }
}

export function listDirs(p: string): string[] {
  try {
    return fs
      .readdirSync(p, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (error) {
    if (isMissingPathError(error)) return [];
    throw error;
  }
}

/** Sub-directories touched in the last two days. */
export function recentSubdirs(root: string, maxAgeMs = TWO_DAYS): string[] {
  const out: string[] = [];
  const now = Date.now();
  for (const name of listDirs(root)) {
    try {
      const st = fs.statSync(path.join(root, name));
      if (now - st.mtimeMs < maxAgeMs) out.push(path.join(root, name));
    } catch {
      /* ignore */
    }
  }
  return out;
}

export function readJsonFile<T = unknown>(p: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as T;
  } catch {
    return null;
  }
}

/** Read a small UTF-8 sidecar without ever allocating or reading beyond the configured limit. */
export function readUtf8FileLimited(p: string, maxBytes = MAX_AUTH_METADATA_BYTES): string {
  const fd = fs.openSync(p, "r");
  try {
    const scratch = Buffer.allocUnsafe(Math.min(64 * 1024, maxBytes + 1));
    const chunks: Buffer[] = [];
    let total = 0;
    while (total <= maxBytes) {
      const read = fs.readSync(fd, scratch, 0, Math.min(scratch.length, maxBytes + 1 - total), null);
      if (read === 0) break;
      total += read;
      if (total > maxBytes) throw new Error(`Metadata file exceeds ${maxBytes} bytes`);
      chunks.push(Buffer.from(scratch.subarray(0, read)));
    }
    return Buffer.concat(chunks, total).toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
}

export function makeRoot(
  dir: string,
  source: string,
  agent: string,
  format: SourceFormat,
  kind: RootKind,
  origin: RootOrigin,
  exts: string[],
  maxDepth = 6,
  text = true,
): SessionRoot {
  return { dir, source, agent, format, kind, origin, exts, maxDepth, text };
}

export function basenameNoExt(p: string): string {
  return path.basename(p).replace(/\.[^.]+$/, "");
}

export function projectNameOf(cwd: string | null): string | null {
  if (!cwd) return null;
  return cwd.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || null;
}

/** Merge sessions that share (agent, sessionId) – used for sources that store one file per message. */
export function mergeSessions(parts: ParsedSession[]): ParsedSession {
  const sorted = [...parts].sort((a, b) => a.startedAt - b.startedAt);
  const base = sorted[0];
  const candidates = sorted.flatMap((s) => s.events).sort((a, b) => a.ts - b.ts);
  const cumulative = { input: 0, cached: 0, cacheWrite: 0, output: 0, reasoning: 0, total: 0, requests: 0 };
  const acceptedEvents: typeof candidates = [];
  for (const event of candidates) if (tryAddUsageInPlace(cumulative, event.usage)) acceptedEvents.push(event);
  const events = acceptedEvents;
  const last = events[events.length - 1];
  const withMeta = sorted.find((s) => s.cwd) ?? base;
  return {
    ...base,
    cwd: withMeta.cwd,
    projectName: withMeta.projectName,
    model: last?.model ?? base.model,
    startedAt: Math.min(...sorted.map((s) => s.startedAt)),
    lastActivityAt: Math.max(...sorted.map((s) => s.lastActivityAt)),
    events,
    cumulative,
    lineCount: sorted.reduce((a, s) => a + s.lineCount, 0),
  };
}
