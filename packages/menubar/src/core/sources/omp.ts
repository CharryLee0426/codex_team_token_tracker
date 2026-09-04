import path from "node:path";
import type { ParsedSession } from "@codex-tracker/shared";
import type { SessionRoot, SourceContext, SourceDefinition, SourceFile, ParseOptions, UserHome } from "./types";
import { isDir, listDirs, makeRoot, recentSubdirs } from "./util";
import { piSource } from "./pi";

export const AGENT_OMP = "omp";

/** oh-my-pi config root for a user home: `$PI_CONFIG_DIR` (absolute, or relative to the home) or `~/.omp`. */
function ompConfigRoot(h: UserHome, env: NodeJS.ProcessEnv): string {
  const cfg = h.origin === "local" && env.PI_CONFIG_DIR ? env.PI_CONFIG_DIR : ".omp";
  return path.isAbsolute(cfg) ? cfg : path.join(h.home, cfg);
}

/**
 * Every directory oh-my-pi may write sessions to for one user home. oh-my-pi keeps pi's layout
 * (`<agent dir>/sessions/<cwd-slug>/<timestamp>_<uuid>.jsonl`) but under its own roots:
 *  - `~/.omp/agent` (`$PI_CONFIG_DIR` replaces `~/.omp`), plus `~/.omp/profiles/<name>/agent` per profile;
 *  - `$XDG_DATA_HOME/omp` (and `…/omp/profiles/<name>`) on macOS / Linux — oh-my-pi moves its data there
 *    whenever that folder exists; `~/.local/share/omp` is checked too for homes whose env we cannot see;
 *  - `$PI_CODING_AGENT_SESSION_DIR`, an explicit session-directory override.
 * `$PI_CODING_AGENT_DIR` is shared with pi and already scanned (as `pi`) by the pi source.
 */
export function ompSessionDirs(h: UserHome, env: NodeJS.ProcessEnv): string[] {
  const local = h.origin === "local";
  const out: string[] = [];
  const root = ompConfigRoot(h, env);
  out.push(path.join(root, "agent", "sessions"));
  for (const profile of listDirs(path.join(root, "profiles"))) out.push(path.join(root, "profiles", profile, "agent", "sessions"));
  if (h.layout !== "win32") {
    const dataHomes = new Set<string>();
    if (local && env.XDG_DATA_HOME) dataHomes.add(env.XDG_DATA_HOME);
    dataHomes.add(path.join(h.home, ".local", "share"));
    for (const dataHome of dataHomes) {
      const data = path.join(dataHome, "omp");
      out.push(path.join(data, "sessions"));
      for (const profile of listDirs(path.join(data, "profiles"))) out.push(path.join(data, "profiles", profile, "sessions"));
    }
  }
  if (local && env.PI_CODING_AGENT_SESSION_DIR) out.push(env.PI_CODING_AGENT_SESSION_DIR);
  return out;
}

/**
 * oh-my-pi (github.com/can1357/oh-my-pi, the `omp` command): a pi fork that writes the same session
 * JSONL as pi — `provider: "openai-codex"` messages are Codex-subscription usage — under `~/.omp`
 * instead of `~/.pi`, so it needs its own roots but reuses the pi parser.
 */
export const ompSource: SourceDefinition = {
  id: AGENT_OMP,
  label: "oh-my-pi",
  format: "pi",
  discover(ctx: SourceContext): SessionRoot[] {
    const roots: SessionRoot[] = [];
    for (const h of ctx.homes) {
      for (const dir of ompSessionDirs(h, ctx.env)) {
        if (isDir(dir)) roots.push(makeRoot(dir, AGENT_OMP, AGENT_OMP, "pi", "flat", h.origin, [".jsonl"], 3));
      }
    }
    return roots;
  },
  hotDirs: (root) => [root.dir, ...recentSubdirs(root.dir)],
  watchRecursively: () => true,
  async parsePath(file, opts): Promise<ParsedSession | null> {
    if (!piSource.parsePath) return null;
    const session = await piSource.parsePath(file, opts);
    return session ? { ...session, originator: AGENT_OMP, source: AGENT_OMP } : null;
  },
  parse(file: SourceFile, opts: ParseOptions): ParsedSession | null {
    // Same transcript format as pi; the pi source stamps `file.root.agent` ("omp") on the session and its events.
    const s = piSource.parse(file, opts);
    return s ? { ...s, originator: AGENT_OMP, source: AGENT_OMP } : null;
  },
  extraRoot: (dir, agent) => makeRoot(dir, AGENT_OMP, agent, "pi", "extra", "extra", [".jsonl"], 3),
};
