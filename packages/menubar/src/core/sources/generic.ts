import { parseGenericSessionText } from "@codex-tracker/shared";
import type { SourceDefinition, SourceFile, ParseOptions } from "./types";
import { basenameNoExt, makeRoot, recentSubdirs } from "./util";

/** Best-effort JSON / JSONL transcripts with per-request usage objects (used for hermes and custom dirs). */
export const genericSource: SourceDefinition = {
  id: "generic",
  label: "Generic JSON/JSONL",
  format: "generic",
  discover: () => [],
  hotDirs: (root) => [root.dir, ...recentSubdirs(root.dir)],
  watchRecursively: () => true,
  parse(file: SourceFile, opts: ParseOptions) {
    return parseGenericSessionText(file.text, basenameNoExt(file.path), { agent: file.root.agent, includeAllProviders: opts.includeAllProviders });
  },
  extraRoot: (dir, agent) => makeRoot(dir, "generic", agent, "generic", "extra", "extra", [".jsonl", ".json"], 4),
};
