import fs from "node:fs";
import type { ParsedSession } from "@codex-tracker/shared";
import type { ExtraSessionDir, SourcesConfig } from "./config";
import { discoverSessionRootsWithStatus, listFiles, mergeSessions, sourceFor, walkFilesWithStatus, type SessionRoot } from "./sources";
import { sqliteFileVersion } from "./sources/sqlite";

export interface FileEntry {
  path: string;
  size: number;
  mtimeMs: number;
  root: SessionRoot;
  session: ParsedSession | null;
}

export interface StoreOptions {
  extraSessionDirs: Array<string | ExtraSessionDir>;
  sources: SourcesConfig;
  trackAllProviders: boolean;
}

const DAY = 86_400_000;
const MAX_FILE_BYTES = 50 * 1024 * 1024;
const USAGE_FIELDS = ["input", "cached", "cacheWrite", "output", "reasoning", "total", "requests"] as const;

function shouldKeepPreviousAppendOnlySnapshot(
  root: SessionRoot,
  previous: ParsedSession | null | undefined,
  next: ParsedSession | null,
  allowDownwardCorrection: boolean,
): boolean {
  if (!["codex", "dsh", "pi"].includes(root.format) || !previous) return false;
  // A disappeared/changed auth sidecar must be allowed to evict previously counted data. Retaining
  // last-good is safe only while the source still has positive OAuth attribution (pi carries that
  // marker in each event and therefore has no root-level discriminator).
  if ((root.format === "codex" || root.format === "dsh") && root.oauthAttribution !== "oauth") return false;
  if (!next || next.sessionId !== previous.sessionId) return true;
  if (next.lineCount < previous.lineCount) return true;
  if (root.format !== "codex") return false;
  if (next.cumulative.requests < previous.cumulative.requests) return true;
  return !allowDownwardCorrection && USAGE_FIELDS.some((field) => next.cumulative[field] < previous.cumulative[field]);
}

function entryIsAtLeastAsNew(entry: FileEntry, version: Pick<FileEntry, "size" | "mtimeMs">): boolean {
  return entry.mtimeMs > version.mtimeMs || (entry.mtimeMs === version.mtimeMs && entry.size >= version.size);
}

function rootKey(root: SessionRoot): string {
  return `${root.dir}\0${root.source}\0${root.format}\0${root.kind}\0${root.origin}`;
}

function isMissingFileError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

/**
 * In-memory index of agent transcript files → parsed sessions (Codex rollouts, pi, OpenCode, Cline, hermes, …).
 * - `refreshDeep()` walks every session root (start-up / every minute).
 * - `refreshShallow()` only re-checks recently active files and "hot" folders (every few seconds).
 * Files are re-parsed only when their size or mtime changed.
 */
export class SessionStore {
  readonly files = new Map<string, FileEntry>();
  roots: SessionRoot[] = [];
  private watchers = new Map<string, fs.FSWatcher>();
  private onChange: (() => void) | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;
  private sessionCache: ParsedSession[] | null = null;
  private forceDeepRefresh = false;
  private retryFiles = new Set<string>();

  constructor(private readonly getOptions: () => StoreOptions) {}

  /**
   * Mark every file stale so the next deep refresh re-reads and re-parses every transcript.
   * The current index stays readable until that refresh completes, preventing full sync from exposing
   * a transient empty snapshot.
   */
  reset() {
    this.forceDeepRefresh = true;
  }

  async refreshDeep(): Promise<boolean> {
    const force = this.forceDeepRefresh;
    this.forceDeepRefresh = false;
    const entriesAtStart = new Map(this.files);
    const o = this.getOptions();
    const discovery = discoverSessionRootsWithStatus({ extraSessionDirs: o.extraSessionDirs, sources: o.sources });
    this.roots = discovery.roots;
    const present = new Set<string>();
    const activeRoots = new Set<string>();
    const completelyWalkedRoots = new Set<string>();
    let incomplete = discovery.incompleteSources.size > 0;
    let changed = false;
    for (const root of this.roots) {
      const key = rootKey(root);
      activeRoots.add(key);
      const walk = walkFilesWithStatus(root);
      if (walk.complete) completelyWalkedRoots.add(key);
      else incomplete = true;
      for (const p of walk.files) {
        present.add(p);
        if (await this.syncFile(p, root, force)) changed = true;
      }
    }
    for (const p of [...this.files.keys()]) {
      if (!present.has(p)) {
        const entryAtStart = entriesAtStart.get(p);
        if (!entryAtStart || this.files.get(p) !== entryAtStart) continue;
        const key = rootKey(entryAtStart.root);
        if (activeRoots.has(key) && !completelyWalkedRoots.has(key)) continue;
        if (!activeRoots.has(key) && discovery.incompleteSources.has(entryAtStart.root.source)) continue;
        this.files.delete(p);
        this.retryFiles.delete(p);
        changed = true;
      }
    }
    // A forced rescan that could not see every enabled root/file has not fulfilled its contract.
    // Keep it armed so the first recovered deep scan reparses unchanged files as well.
    if (force && incomplete) this.forceDeepRefresh = true;
    if (changed) this.sessionCache = null;
    this.syncWatchers();
    return changed;
  }

  async refreshShallow(): Promise<boolean> {
    const now = Date.now();
    const candidates = new Map<string, SessionRoot>();
    for (const [p, e] of this.files) if (now - e.mtimeMs < DAY) candidates.set(p, e.root);
    for (const root of this.roots) {
      for (const d of sourceFor(root).hotDirs(root)) for (const p of listFiles(d, root.exts)) candidates.set(p, root);
    }
    let changed = false;
    for (const [p, root] of candidates) if (await this.syncFile(p, root)) changed = true;
    if (changed) this.sessionCache = null;
    return changed;
  }

  /** Re-stat one file and parse it if it changed. Returns true when the index changed. */
  private async syncFile(p: string, root: SessionRoot, force = false): Promise<boolean> {
    const entryBeforeStat = this.files.get(p);
    let st: fs.Stats;
    try {
      st = await fs.promises.stat(p);
    } catch (error) {
      if (!isMissingFileError(error)) {
        if (force && entryBeforeStat) this.retryFiles.add(p);
        return false;
      }
      if (this.files.get(p) !== entryBeforeStat) return false;
      if (this.files.delete(p)) {
        this.retryFiles.delete(p);
        return true;
      }
      return false;
    }
    const source = sourceFor(root);
    let version: { size: number; mtimeMs: number };
    try {
      version = source.fileVersion?.(p, st, root)
        ?? (root.text ? { size: st.size, mtimeMs: st.mtimeMs } : sqliteFileVersion(p, st));
    } catch {
      // Auth sidecars and SQLite WAL files are part of a source's version. Operational failures
      // reading either are transient, so retain the last valid snapshot and retry later.
      if (force && entryBeforeStat) this.retryFiles.add(p);
      return false;
    }
    const prev = this.files.get(p);
    if (!force && !this.retryFiles.has(p) && prev && prev.size === version.size && prev.mtimeMs === version.mtimeMs) return false;
    let session: ParsedSession | null = null;
    try {
      const preferPathParser = source.parsePath && source.preferParsePath?.(p);
      if (root.text && (st.size > MAX_FILE_BYTES || preferPathParser) && source.parsePath) {
        session = await source.parsePath({ path: p, root }, { includeAllProviders: this.getOptions().trackAllProviders });
      } else if (!root.text || st.size <= MAX_FILE_BYTES) {
        const text = root.text ? await fs.promises.readFile(p, "utf8") : "";
        session = source.parse({ path: p, text, root }, { includeAllProviders: this.getOptions().trackAllProviders });
      } else {
        return false;
      }
    } catch {
      // Keep the last valid snapshot and retry on a later refresh.
      if (force && prev) this.retryFiles.add(p);
      return false;
    }
    const current = this.files.get(p);
    if (current !== prev) {
      if (!current) return false;
      const sameVersion = current.size === version.size && current.mtimeMs === version.mtimeMs;
      if (entryIsAtLeastAsNew(current, version) && !(force && sameVersion)) return false;
    }
    const previousSession = current?.session ?? prev?.session;
    const keptPrevious = shouldKeepPreviousAppendOnlySnapshot(root, previousSession, session, force);
    if (keptPrevious) {
      session = previousSession!;
      if (force) this.retryFiles.add(p);
    } else {
      this.retryFiles.delete(p);
    }
    const sessionsChanged = !current || session !== current.session;
    this.files.set(p, { path: p, size: version.size, mtimeMs: version.mtimeMs, root, session });
    return sessionsChanged;
  }

  /**
   * All parsed sessions keyed by (agent, session id): copies (e.g. Codex archived rollouts) resolve to the
   * most recently active one; multi-file sources (OpenCode) are merged.
   */
  sessions(): ParsedSession[] {
    if (this.sessionCache) return this.sessionCache;
    const byId = new Map<string, ParsedSession[]>();
    for (const e of this.files.values()) {
      const s = e.session;
      if (!s) continue;
      const key = `${s.agent}:${s.sessionId}`;
      const list = byId.get(key);
      if (list) list.push(s);
      else byId.set(key, [s]);
    }
    const out: ParsedSession[] = [];
    for (const list of byId.values()) {
      if (list.length === 1) {
        out.push(list[0]);
        continue;
      }
      const multi = list.some((s) => s.source === "opencode" || s.originator === "opencode");
      if (multi) out.push(mergeSessions(list));
      else out.push(list.reduce((a, b) => (b.lastActivityAt >= a.lastActivityAt ? b : a)));
    }
    this.sessionCache = out;
    return out;
  }

  get fileCount(): number {
    return this.files.size;
  }

  /** Session/file counts per agent. */
  countsByAgent(): Record<string, { sessions: number; files: number }> {
    const out: Record<string, { sessions: number; files: number }> = {};
    for (const e of this.files.values()) {
      const a = e.root.agent;
      out[a] ??= { sessions: 0, files: 0 };
      out[a].files++;
    }
    for (const s of this.sessions()) {
      out[s.agent] ??= { sessions: 0, files: 0 };
      out[s.agent].sessions++;
    }
    return out;
  }

  startWatching(onChange: () => void) {
    this.onChange = onChange;
    this.syncWatchers();
  }

  stopWatching() {
    this.onChange = null;
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
  }

  /** Keep fs.watch handles on the roots and the "hot" folders (created lazily by the agents). */
  private syncWatchers() {
    if (!this.onChange) return;
    const wanted = new Map<string, boolean>(); // dir → recursive
    for (const root of this.roots) {
      const def = sourceFor(root);
      const recursive = def.watchRecursively(root);
      wanted.set(root.dir, recursive);
      if (!recursive) for (const d of def.hotDirs(root)) if (!wanted.has(d)) wanted.set(d, false);
    }
    for (const [dir, w] of this.watchers) {
      if (!wanted.has(dir)) {
        w.close();
        this.watchers.delete(dir);
      }
    }
    for (const [dir, recursive] of wanted) {
      if (this.watchers.has(dir)) continue;
      try {
        if (!fs.existsSync(dir)) continue;
        const w = fs.watch(dir, { persistent: false, recursive }, () => this.scheduleChange());
        w.on("error", () => {
          w.close();
          this.watchers.delete(dir);
        });
        this.watchers.set(dir, w);
      } catch {
        // network mounts (\\wsl$, /mnt/c) or platforms without recursive watch; polling covers them
      }
    }
  }

  private scheduleChange() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.onChange?.();
    }, 500);
  }

  static rootDirs(roots: SessionRoot[]): string[] {
    return roots.map((r) => r.dir);
  }
}
