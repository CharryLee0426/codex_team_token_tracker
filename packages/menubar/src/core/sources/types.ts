import type { ParsedSession } from "@codex-tracker/shared";
import type { Stats } from "node:fs";
import type { SourceFormat } from "../config";
import type { PlatformKind } from "../platform";

export type RootKind = "sessions" | "archived" | "flat" | "extra";
export type RootOrigin = "local" | "wsl" | "windows" | "extra";

export interface SessionRoot {
  dir: string;
  /** Registry id of the source that parses this root ("codex", "pi", "opencode", "cline", "hermes", "generic", …). */
  source: string;
  /** Agent name stamped on events/sessions (= source id, or custom for extra dirs / cline family). */
  agent: string;
  format: SourceFormat;
  /** sessions = Codex YYYY/MM/DD tree, archived = Codex flat archive, flat = per-project tree, extra = user-configured. */
  kind: RootKind;
  origin: RootOrigin;
  /** File name suffixes to index (matched with endsWith). */
  exts: string[];
  maxDepth: number;
  /** Read the file as text before `parse` (false for binary stores such as SQLite). */
  text: boolean;
  /** Current non-secret auth classification used to distinguish an intentional exclusion from a torn transcript. */
  oauthAttribution?: "oauth" | "non-oauth" | "unknown";
}

export interface UserHome {
  home: string;
  origin: RootOrigin;
  /** OS layout of that home (Windows users seen from WSL are "win32"). */
  layout: "darwin" | "linux" | "win32";
}

export interface SourceContext {
  homes: UserHome[];
  platform: PlatformKind;
  env: NodeJS.ProcessEnv;
}

export interface ParseOptions {
  includeAllProviders: boolean;
}

export interface SourceFile {
  path: string;
  text: string;
  root: SessionRoot;
}

export interface SourceDefinition {
  id: string;
  label: string;
  format: SourceFormat;
  /** Sessions span several files (one file per message) and must be merged by session id. */
  multiFileSessions?: boolean;
  /** Auto-discover existing roots (skipped for extra dirs). */
  discover(ctx: SourceContext): SessionRoot[];
  /** Directories that receive new files right now (polled every few seconds and watched). */
  hotDirs(root: SessionRoot): string[];
  /** Watch the root recursively instead of watching hot dirs individually. */
  watchRecursively(root: SessionRoot): boolean;
  /** Optional version including sidecars such as SQLite WAL or auth-discriminator files. */
  fileVersion?(path: string, stat: Stats, root: SessionRoot): { size: number; mtimeMs: number };
  /** Optional bounded-memory parser for text transcripts too large to load as one string. */
  parsePath?(file: Omit<SourceFile, "text">, opts: ParseOptions): Promise<ParsedSession | null>;
  /** Prefer the bounded path parser even below the store's large-file threshold (for compressed inputs). */
  preferParsePath?(path: string): boolean;
  parse(file: SourceFile, opts: ParseOptions): ParsedSession | null;
  /** Root template for a user-configured extra directory of this format. */
  extraRoot(dir: string, agent: string): SessionRoot;
}
