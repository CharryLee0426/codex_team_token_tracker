import fs from "node:fs";
import path from "node:path";
import { createSessionParser, sessionIdFromFilename, type ParsedSession } from "@codex-tracker/shared";
import { discoverSessionRoots, walkJsonl, listJsonl, hotDirs, type SessionRoot } from "./scanner";

export interface FileEntry {
  path: string;
  size: number;
  mtimeMs: number;
  session: ParsedSession | null;
}

const DAY = 86_400_000;

/**
 * In-memory index of Codex rollout files → parsed sessions.
 * - `refreshDeep()` walks every session root (start-up / every minute).
 * - `refreshShallow()` only re-checks recently active files and today's folders (every few seconds).
 * Files are re-parsed only when their size or mtime changed.
 */
export class SessionStore {
  readonly files = new Map<string, FileEntry>();
  roots: SessionRoot[] = [];
  private watchers = new Map<string, fs.FSWatcher>();
  private onChange: (() => void) | null = null;
  private debounceTimer: NodeJS.Timeout | null = null;

  constructor(private readonly extraDirs: () => string[]) {}

  async refreshDeep(): Promise<boolean> {
    this.roots = discoverSessionRoots(this.extraDirs());
    const present = new Set<string>();
    let changed = false;
    for (const root of this.roots) {
      for (const p of walkJsonl(root.dir)) {
        present.add(p);
        if (await this.syncFile(p)) changed = true;
      }
    }
    for (const p of [...this.files.keys()]) {
      if (!present.has(p)) {
        this.files.delete(p);
        changed = true;
      }
    }
    this.syncWatchers();
    return changed;
  }

  async refreshShallow(): Promise<boolean> {
    const now = Date.now();
    const candidates = new Set<string>();
    for (const [p, e] of this.files) if (now - e.mtimeMs < DAY) candidates.add(p);
    for (const root of this.roots) for (const d of hotDirs(root)) for (const p of listJsonl(d)) candidates.add(p);
    let changed = false;
    for (const p of candidates) if (await this.syncFile(p)) changed = true;
    return changed;
  }

  /** Re-stat one file and parse it if it changed. Returns true when the index changed. */
  private async syncFile(p: string): Promise<boolean> {
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
    try {
      const text = await fs.promises.readFile(p, "utf8");
      const parser = createSessionParser(sessionIdFromFilename(p));
      for (const line of text.split(/\r?\n/)) parser.push(line);
      session = parser.result();
    } catch {
      session = null;
    }
    this.files.set(p, { path: p, size: st.size, mtimeMs: st.mtimeMs, session });
    return true;
  }

  /** All parsed sessions, de-duplicated by session id (archived copies win by latest activity). */
  sessions(): ParsedSession[] {
    const byId = new Map<string, ParsedSession>();
    for (const e of this.files.values()) {
      const s = e.session;
      if (!s) continue;
      const prev = byId.get(s.sessionId);
      if (!prev || s.lastActivityAt >= prev.lastActivityAt) byId.set(s.sessionId, s);
    }
    return [...byId.values()];
  }

  get fileCount(): number {
    return this.files.size;
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

  /** Keep fs.watch handles on the roots and the "hot" day folders (created lazily by Codex). */
  private syncWatchers() {
    if (!this.onChange) return;
    const wanted = new Set<string>();
    for (const root of this.roots) {
      wanted.add(root.dir);
      for (const d of hotDirs(root)) wanted.add(d);
    }
    for (const [dir, w] of this.watchers) {
      if (!wanted.has(dir)) {
        w.close();
        this.watchers.delete(dir);
      }
    }
    for (const dir of wanted) {
      if (this.watchers.has(dir)) continue;
      try {
        if (!fs.existsSync(dir)) continue;
        const w = fs.watch(dir, { persistent: false }, () => this.scheduleChange());
        w.on("error", () => {
          w.close();
          this.watchers.delete(dir);
        });
        this.watchers.set(dir, w);
      } catch {
        // network mounts (\\wsl$, /mnt/c) may not support watching; polling covers them
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

  static describeRoot(root: SessionRoot): string {
    return `${root.dir}${root.origin !== "local" ? ` [${root.origin}]` : ""}`;
  }

  static rootDirs(roots: SessionRoot[]): string[] {
    return roots.map((r) => path.normalize(r.dir));
  }
}
