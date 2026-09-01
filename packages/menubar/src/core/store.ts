import fs from "node:fs";
import type { ParsedSession } from "@codex-tracker/shared";
import type { ExtraSessionDir, SourcesConfig } from "./config";
import { discoverSessionRoots, listFiles, mergeSessions, sourceFor, walkFiles, type SessionRoot } from "./sources";

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

  constructor(private readonly getOptions: () => StoreOptions) {}

  /**
   * Forget the parsed-file index so the next deep refresh re-reads and re-parses every transcript.
   * Used by the full sync: files are otherwise skipped while their size and mtime are unchanged, which
   * would keep stale numbers around after a parser or pricing change.
   */
  reset() {
    this.files.clear();
    this.sessionCache = null;
  }

  async refreshDeep(): Promise<boolean> {
    const o = this.getOptions();
    this.roots = discoverSessionRoots({ extraSessionDirs: o.extraSessionDirs, sources: o.sources });
    const present = new Set<string>();
    let changed = false;
    for (const root of this.roots) {
      for (const p of walkFiles(root)) {
        present.add(p);
        if (await this.syncFile(p, root)) changed = true;
      }
    }
    for (const p of [...this.files.keys()]) {
      if (!present.has(p)) {
        this.files.delete(p);
        changed = true;
      }
    }
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
  private async syncFile(p: string, root: SessionRoot): Promise<boolean> {
    let st: fs.Stats;
    try {
      st = await fs.promises.stat(p);
    } catch {
      if (this.files.delete(p)) return true;
      return false;
    }
    const prev = this.files.get(p);
    if (prev && prev.size === st.size && prev.mtimeMs === st.mtimeMs) return false;
    let session: ParsedSession | null = null;
    if (st.size <= MAX_FILE_BYTES) {
      try {
        const text = root.text ? await fs.promises.readFile(p, "utf8") : "";
        session = sourceFor(root).parse({ path: p, text, root }, { includeAllProviders: this.getOptions().trackAllProviders });
      } catch {
        session = null;
      }
    }
    this.files.set(p, { path: p, size: st.size, mtimeMs: st.mtimeMs, root, session });
    return true;
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
