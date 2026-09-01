import os from "node:os";
import path from "node:path";
import { createPiSessionParser, piSessionIdFromFilename } from "@codex-tracker/shared";
import type { SessionRoot, SourceContext, SourceDefinition, SourceFile, ParseOptions } from "./types";
import { isDir, makeRoot, recentSubdirs } from "./util";

/** pi coding agent home (`$PI_CODING_AGENT_DIR`, default ~/.pi/agent). */
export function piHome(): string {
  return process.env.PI_CODING_AGENT_DIR || path.join(os.homedir(), ".pi", "agent");
}

/** `<home>/<rel…>`, honoring an env override only for the machine's own home directory. */
function underHome(h: { home: string }, envVar: string | undefined, ...rel: string[]): string {
  if (envVar && h.home === os.homedir()) return envVar;
  return path.join(h.home, ...rel);
}


/** pi (github.com/badlogic/pi-mono): ~/.pi/agent/sessions/<cwd-slug>/<timestamp>_<uuid>.jsonl */
export const piSource: SourceDefinition = {
  id: "pi",
  label: "pi coding agent",
  format: "pi",
  discover(ctx: SourceContext): SessionRoot[] {
    const roots: SessionRoot[] = [];
    for (const h of ctx.homes) {
      const dir = path.join(underHome(h, process.env.PI_CODING_AGENT_DIR, ".pi", "agent"), "sessions");
      if (isDir(dir)) roots.push(makeRoot(dir, "pi", "pi", "pi", "flat", h.origin, [".jsonl"], 3));
    }
    return roots;
  },
  hotDirs: (root) => [root.dir, ...recentSubdirs(root.dir)],
  watchRecursively: () => true,
  parse(file: SourceFile, opts: ParseOptions) {
    const parser = createPiSessionParser(piSessionIdFromFilename(file.path), { includeAllProviders: opts.includeAllProviders });
    for (const line of file.text.split(/\r?\n/)) parser.push(line);
    const s = parser.result();
    if (s && file.root.agent !== "pi") return { ...s, agent: file.root.agent, events: s.events.map((e) => ({ ...e, agent: file.root.agent })) };
    return s;
  },
  extraRoot: (dir, agent) => makeRoot(dir, "pi", agent, "pi", "extra", "extra", [".jsonl"], 3),
};
