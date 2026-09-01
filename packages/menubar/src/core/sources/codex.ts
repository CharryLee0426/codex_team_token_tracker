import os from "node:os";
import path from "node:path";
import { createSessionParser, sessionIdFromFilename } from "@codex-tracker/shared";
import type { SessionRoot, SourceContext, SourceDefinition, SourceFile } from "./types";
import { isDir, makeRoot } from "./util";

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

/** Codex CLI / Codex Desktop rollouts: ~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl and ~/.codex/archived_sessions. */
export const codexSource: SourceDefinition = {
  id: "codex",
  label: "Codex CLI / Desktop",
  format: "codex",
  discover(ctx: SourceContext): SessionRoot[] {
    const roots: SessionRoot[] = [];
    for (const h of ctx.homes) {
      const home = underHome(h, process.env.CODEX_HOME, ".codex");
      const sessions = path.join(home, "sessions");
      const archived = path.join(home, "archived_sessions");
      if (isDir(sessions)) roots.push(makeRoot(sessions, "codex", "codex", "codex", "sessions", h.origin, [".jsonl"]));
      if (isDir(archived)) roots.push(makeRoot(archived, "codex", "codex", "codex", "archived", h.origin, [".jsonl"], 1));
    }
    return roots;
  },
  hotDirs(root: SessionRoot): string[] {
    return root.kind === "sessions" || root.kind === "extra" ? [root.dir, ...dateDirs(root.dir)] : [root.dir];
  },
  watchRecursively: () => false,
  parse(file: SourceFile) {
    const parser = createSessionParser(sessionIdFromFilename(file.path));
    for (const line of file.text.split(/\r?\n/)) parser.push(line);
    const s = parser.result();
    if (s && file.root.agent !== "codex") return { ...s, agent: file.root.agent, events: s.events.map((e) => ({ ...e, agent: file.root.agent })) };
    return s;
  },
  extraRoot: (dir, agent) => makeRoot(dir, "codex", agent, "codex", "extra", "extra", [".jsonl"]),
};
