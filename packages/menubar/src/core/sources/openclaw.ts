import fs from "node:fs";
import path from "node:path";
import { createGenericSessionParser, type ParsedSession } from "@codex-tracker/shared";
import { isMap, isScalar, isSeq, parseDocument } from "yaml";
import type { ParseOptions, SessionRoot, SourceContext, SourceDefinition, SourceFile, UserHome } from "./types";
import { codexSource } from "./codex";
import { genericSource } from "./generic";
import { openSqliteReadOnlyOrThrow, sqliteRows, sqliteSessionId, sqliteTableNamesOrThrow } from "./sqlite";
import { isDir, isFile, listDirs, makeRoot, recentSubdirs } from "./util";

const PROFILE_DIR_RE = /^\.openclaw-[a-z0-9][a-z0-9_-]{0,63}$/i;
const MAX_NAMED_PROFILES = 64;
const MAX_CONFIG_BYTES = 2 * 1024 * 1024;
const MAX_AGENTS_PER_STATE = 256;
const MAX_REGISTERED_DATABASES = 512;
const MAX_DURABLE_EVENT_ID_CHARS = 4_096;

function resolveUserPath(value: string, h: UserHome, env: NodeJS.ProcessEnv): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 4_096 || trimmed.includes("\0")) return null;

  let expanded = "";
  for (let index = 0; index < trimmed.length; index++) {
    if (trimmed[index] !== "$" || trimmed[index + 1] !== "{") {
      expanded += trimmed[index];
      continue;
    }
    const end = trimmed.indexOf("}", index + 2);
    if (end === -1) return null;
    const name = trimmed.slice(index + 2, end);
    if (!/^[A-Z_][A-Z0-9_]*$/.test(name)) return null;
    const replacement = env[name];
    if (!replacement) return null;
    expanded += replacement;
    index = end;
  }

  if (expanded === "~") return h.home;
  if (/^~[\\/]/.test(expanded)) return path.resolve(h.home, expanded.slice(2));
  return path.resolve(expanded);
}

function namedProfileStateDirs(h: UserHome): string[] {
  const profiles: string[] = [];
  try {
    for (const entry of fs.readdirSync(h.home, { withFileTypes: true })) {
      if (!PROFILE_DIR_RE.test(entry.name)) continue;
      const candidate = path.join(h.home, entry.name);
      if (entry.isDirectory() || isDir(candidate)) profiles.push(candidate);
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw error;
  }
  if (profiles.length > MAX_NAMED_PROFILES) throw new Error("OpenClaw named-profile discovery limit exceeded");
  return profiles.sort();
}

function stateDirs(h: UserHome, env: NodeJS.ProcessEnv): string[] {
  if (h.origin === "local" && env.OPENCLAW_STATE_DIR?.trim()) {
    const configured = resolveUserPath(env.OPENCLAW_STATE_DIR, h, env);
    return configured ? [configured] : [];
  }
  return [
    path.join(h.home, ".openclaw"),
    path.join(h.home, ".clawdbot"),
    ...namedProfileStateDirs(h),
  ];
}

/** Remove JSON5 comments without treating URL-like text inside quoted values as comments. */
function stripJson5Comments(raw: string): string {
  let output = "";
  let quote: "\"" | "'" | null = null;
  let escaped = false;
  for (let index = 0; index < raw.length; index++) {
    const current = raw[index];
    const next = raw[index + 1];
    if (quote) {
      output += current;
      if (escaped) escaped = false;
      else if (current === "\\") escaped = true;
      else if (current === quote) quote = null;
      continue;
    }
    if (current === "\"" || current === "'") {
      quote = current;
      output += current;
      continue;
    }
    if (current === "/" && next === "/") {
      output += "  ";
      index += 2;
      while (index < raw.length && raw[index] !== "\n" && raw[index] !== "\r") {
        output += " ";
        index++;
      }
      if (index < raw.length) output += raw[index];
      continue;
    }
    if (current === "/" && next === "*") {
      output += "  ";
      index += 2;
      while (index < raw.length && !(raw[index] === "*" && raw[index + 1] === "/")) {
        output += raw[index] === "\n" || raw[index] === "\r" ? raw[index] : " ";
        index++;
      }
      if (index < raw.length) {
        output += "  ";
        index++;
      }
      continue;
    }
    output += current;
  }
  return output;
}

function scalarString(value: unknown): string | null {
  return isScalar(value) && typeof value.value === "string" ? value.value : null;
}

interface ConfiguredAgentDir {
  agentId: string;
  agentDir: string;
}

function normalizeAgentId(value: string): string | null {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return normalized || null;
}

function configuredAgentDirs(file: string, h: UserHome, env: NodeJS.ProcessEnv): ConfiguredAgentDir[] {
  let raw: string;
  try {
    const stat = fs.statSync(file);
    if (!stat.isFile()) return [];
    if (stat.size > MAX_CONFIG_BYTES) throw new Error("OpenClaw config exceeds the discovery size limit");
    raw = fs.readFileSync(file, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw error;
  }

  const document = parseDocument(stripJson5Comments(raw), {
    prettyErrors: false,
    schema: "core",
    uniqueKeys: true,
  });
  if (document.errors.length) throw new Error("Invalid OpenClaw config metadata");
  const output: ConfiguredAgentDir[] = [];
  const add = (rawId: string | null, rawDir: string | null) => {
    if (rawId === null || rawDir === null) return;
    const agentId = normalizeAgentId(rawId);
    const agentDir = resolveUserPath(rawDir, h, env);
    if (agentId && agentDir) output.push({ agentId, agentDir });
    if (output.length > MAX_AGENTS_PER_STATE) throw new Error("OpenClaw configured-agent discovery limit exceeded");
  };

  const entries = document.getIn(["agents", "entries"], true);
  if (isMap(entries)) {
    for (const pair of entries.items) {
      add(scalarString(pair.key), isMap(pair.value) ? scalarString(pair.value.get("agentDir", true)) : null);
    }
    return output;
  }

  const list = document.getIn(["agents", "list"], true);
  if (!isSeq(list)) return [];
  for (const item of list.items) {
    if (!isMap(item)) continue;
    add(scalarString(item.get("id", true)), scalarString(item.get("agentDir", true)));
  }
  return output;
}

function activeStateDir(h: UserHome, env: NodeJS.ProcessEnv): string {
  const override = h.origin === "local" ? env.OPENCLAW_STATE_DIR?.trim() : undefined;
  if (override) return resolveUserPath(override, h, env) ?? path.join(h.home, ".openclaw");
  const profile = h.origin === "local" ? env.OPENCLAW_PROFILE?.trim() : undefined;
  if (profile && profile.toLowerCase() !== "default" && /^[a-z0-9][a-z0-9_-]{0,63}$/i.test(profile)) {
    return path.join(h.home, `.openclaw-${profile}`);
  }
  const current = path.join(h.home, ".openclaw");
  return isDir(current) ? current : path.join(h.home, ".clawdbot");
}

function configFileForState(state: string, h: UserHome, env: NodeJS.ProcessEnv): string | null {
  if (h.origin === "local" && path.resolve(state) === path.resolve(activeStateDir(h, env))) {
    const override = env.OPENCLAW_CONFIG_PATH?.trim();
    if (override) return resolveUserPath(override, h, env);
  }
  for (const name of ["openclaw.json", "clawdbot.json"]) {
    const candidate = path.join(state, name);
    if (isFile(candidate)) return candidate;
  }
  return null;
}

interface RegisteredAgentDatabase {
  agentId: string;
  path: string;
}

function registeredAgentDatabases(state: string): RegisteredAgentDatabase[] {
  const registryPath = path.join(state, "state", "openclaw.sqlite");
  if (!isFile(registryPath)) return [];
  const database = openSqliteReadOnlyOrThrow(registryPath);
  if (!database) return [];
  try {
    if (!sqliteTableNamesOrThrow(database).has("agent_databases")) return [];
    const columns = new Set(
      database.prepare("PRAGMA table_info(agent_databases)").all().map((column) => String(column.name ?? "")),
    );
    if (!columns.has("agent_id") || !columns.has("path")) return [];
    const rows = database
      .prepare(`SELECT agent_id, path FROM agent_databases ORDER BY agent_id, path LIMIT ${MAX_REGISTERED_DATABASES + 1}`)
      .all();
    if (rows.length > MAX_REGISTERED_DATABASES) throw new Error("OpenClaw registry discovery limit exceeded");
    const output: RegisteredAgentDatabase[] = [];
    for (const row of rows) {
      const agentId = normalizeAgentId(String(row.agent_id ?? ""));
      const storedPath = String(row.path ?? "").trim();
      if (!agentId || !storedPath || storedPath.length > 4_096 || storedPath.includes("\0")) continue;
      output.push({
        agentId,
        path: path.isAbsolute(storedPath) ? path.normalize(storedPath) : path.resolve(state, storedPath),
      });
    }
    return output;
  } finally {
    try {
      database.close();
    } catch {
      /* ignore */
    }
  }
}

function restamp(session: ParsedSession | null, agent: string): ParsedSession | null {
  if (!session) return null;
  return {
    ...session,
    agent,
    originator: agent,
    source: agent,
    events: session.events.map((event) => ({ ...event, agent })).sort((a, b) => a.ts - b.ts),
  };
}

function object(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function durableEventId(event: Record<string, unknown>, message: Record<string, unknown> | null): string | null {
  for (const value of [event.id, message?.id]) {
    if (typeof value === "string" && value.length > 0 && value.length <= MAX_DURABLE_EVENT_ID_CHARS) return value;
  }
  return null;
}

function parseDatabase(file: SourceFile, opts: ParseOptions): ParsedSession | null {
  const db = openSqliteReadOnlyOrThrow(file.path);
  if (!db) return null;
  // Parent-session forks copy transcript rows verbatim, including their durable IDs. Scope the
  // identity set to this one database parse and do not retain the event JSON or message content.
  const seenUsageEventIds = new Set<string>();
  const parser = createGenericSessionParser(sqliteSessionId(file.root.agent, file.path), {
    agent: file.root.agent,
    includeAllProviders: opts.includeAllProviders,
  });
  try {
    if (!sqliteTableNamesOrThrow(db).has("transcript_events")) return null;
    const columns = new Set(db.prepare("PRAGMA table_info(transcript_events)").all().map((column) => String(column.name ?? "")));
    if (!columns.has("event_json") || !columns.has("created_at")) return null;
    for (const row of sqliteRows(db, "SELECT event_json, created_at FROM transcript_events ORDER BY created_at ASC")) {
      let event: Record<string, unknown> | null;
      try {
        event = object(JSON.parse(String(row.event_json ?? "")));
      } catch {
        continue;
      }
      if (!event) continue;
      const message = object(event.message);
      if (message?.role && message.role !== "assistant") continue;
      if (!message?.usage && !event.usage) continue;
      const eventId = durableEventId(event, message);
      if (eventId && seenUsageEventIds.has(eventId)) continue;
      if (eventId) seenUsageEventIds.add(eventId);
      if (message?.usage) {
        parser.pushJson({ timestamp: event.timestamp ?? row.created_at, message });
      } else {
        parser.pushJson({ ...event, timestamp: event.timestamp ?? row.created_at });
      }
    }
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
  return restamp(parser.result(), file.root.agent);
}

type TranscriptDatabaseStatus = "supported" | "unsupported" | "unreadable";

function transcriptDatabaseStatus(file: string): TranscriptDatabaseStatus {
  let db;
  try {
    db = openSqliteReadOnlyOrThrow(file);
  } catch {
    return "unreadable";
  }
  if (!db) return "unsupported";
  try {
    if (!sqliteTableNamesOrThrow(db).has("transcript_events")) return "unsupported";
    const columns = new Set(db.prepare("PRAGMA table_info(transcript_events)").all().map((column) => String(column.name ?? "")));
    return columns.has("event_json") && columns.has("created_at") ? "supported" : "unsupported";
  } catch {
    return "unreadable";
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }
}

interface AgentLocations {
  defaultRuntime: string | null;
  configuredRuntime: string | null;
  registeredDatabases: Set<string>;
  registeredRuntimes: Set<string>;
  legacySessions: Set<string>;
}

function agentLocations(agents: Map<string, AgentLocations>, agentId: string): AgentLocations | null {
  const existing = agents.get(agentId);
  if (existing) return existing;
  if (agents.size >= MAX_AGENTS_PER_STATE) throw new Error("OpenClaw agent discovery limit exceeded");
  const locations: AgentLocations = {
    defaultRuntime: null,
    configuredRuntime: null,
    registeredDatabases: new Set(),
    registeredRuntimes: new Set(),
    legacySessions: new Set(),
  };
  agents.set(agentId, locations);
  return locations;
}

/** OpenClaw's attributable transcript DB/legacy JSONL plus diagnostic-only managed Codex rollouts. */
export const openclawSource: SourceDefinition = {
  id: "openclaw",
  label: "OpenClaw",
  format: "generic",
  discover(ctx: SourceContext): SessionRoot[] {
    const roots: SessionRoot[] = [];
    const seenRoots = new Set<string>();
    const addRoot = (root: SessionRoot) => {
      const key = `${path.resolve(root.dir)}\0${root.exts.join("\0")}\0${root.format}`;
      if (seenRoots.has(key)) return;
      seenRoots.add(key);
      roots.push(root);
    };

    for (const h of ctx.homes) {
      for (const state of stateDirs(h, ctx.env)) {
        const agents = new Map<string, AgentLocations>();
        const agentIds = listDirs(path.join(state, "agents"));
        if (agentIds.length > MAX_AGENTS_PER_STATE) throw new Error("OpenClaw agent discovery limit exceeded");
        for (const agentId of agentIds) {
          const agentRoot = path.join(state, "agents", agentId);
          const locations = agentLocations(agents, normalizeAgentId(agentId) ?? agentId);
          if (!locations) break;
          locations.defaultRuntime = path.join(agentRoot, "agent");
          locations.legacySessions.add(path.join(agentRoot, "sessions"));
        }

        const configFile = configFileForState(state, h, ctx.env);
        if (configFile) {
          for (const configured of configuredAgentDirs(configFile, h, ctx.env)) {
            const locations = agentLocations(agents, configured.agentId);
            if (!locations) break;
            locations.configuredRuntime = configured.agentDir;
            locations.legacySessions.add(path.join(state, "agents", configured.agentId, "sessions"));
          }
        }

        for (const registered of registeredAgentDatabases(state)) {
          const locations = agentLocations(agents, registered.agentId);
          if (!locations) break;
          locations.registeredDatabases.add(registered.path);
          locations.registeredRuntimes.add(path.dirname(registered.path));
          locations.legacySessions.add(path.join(state, "agents", registered.agentId, "sessions"));
        }

        for (const locations of agents.values()) {
          const runtimes = new Set<string>();
          if (locations.configuredRuntime) runtimes.add(locations.configuredRuntime);
          else if (locations.defaultRuntime) runtimes.add(locations.defaultRuntime);
          for (const runtime of locations.registeredRuntimes) runtimes.add(runtime);

          const databasePaths = new Set(locations.registeredDatabases);
          for (const runtime of runtimes) databasePaths.add(path.join(runtime, "openclaw-agent.sqlite"));
          let hasCurrentDatabase = false;
          for (const database of databasePaths) {
            if (!isFile(database)) continue;
            const databaseStatus = transcriptDatabaseStatus(database);
            if (databaseStatus === "unsupported") continue;
            // An unreadable database may be mid-write or temporarily locked. Keep its root so the
            // parser can throw and SessionStore can retain/retry the previous valid snapshot.
            addRoot(makeRoot(
              path.dirname(database),
              "openclaw",
              "openclaw",
              "generic",
              "flat",
              h.origin,
              [path.basename(database)],
              0,
              false,
            ));
            hasCurrentDatabase = true;
          }
          if (hasCurrentDatabase) continue;

          let managed = false;
          for (const runtime of runtimes) {
            const codexHome = path.join(runtime, "codex-home");
            const sessions = path.join(codexHome, "sessions");
            const archived = path.join(codexHome, "archived_sessions");
            if (isDir(sessions)) {
              addRoot(makeRoot(
                sessions,
                "openclaw",
                "openclaw",
                "codex",
                "sessions",
                h.origin,
                [".jsonl", ".jsonl.zst"],
              ));
              managed = true;
            }
            if (isDir(archived)) {
              addRoot(makeRoot(
                archived,
                "openclaw",
                "openclaw",
                "codex",
                "archived",
                h.origin,
                [".jsonl", ".jsonl.zst"],
                1,
              ));
              managed = true;
            }
          }
          if (managed) continue;
          for (const legacy of locations.legacySessions) {
            if (isDir(legacy)) addRoot(makeRoot(legacy, "openclaw", "openclaw", "generic", "flat", h.origin, [".jsonl", ".json"], 4));
          }
        }
      }
    }
    return roots;
  },
  hotDirs(root) {
    if (!root.text) return [root.dir];
    if (root.format === "codex") return codexSource.hotDirs(root);
    return [root.dir, ...recentSubdirs(root.dir)];
  },
  watchRecursively: (root) => root.text && root.format !== "codex",
  async parsePath(file, opts) {
    if (file.root.format !== "codex" || !codexSource.parsePath) return null;
    return restamp(await codexSource.parsePath(file, opts), file.root.agent);
  },
  preferParsePath: (file) => codexSource.preferParsePath?.(file) ?? false,
  parse(file, opts) {
    if (!file.root.text) return parseDatabase(file, opts);
    if (file.root.format === "codex") return restamp(codexSource.parse(file, opts), file.root.agent);
    return restamp(genericSource.parse(file, opts), file.root.agent);
  },
  extraRoot: (dir, agent) => makeRoot(dir, "openclaw", agent, "generic", "extra", "extra", [".jsonl", ".json"], 4),
};
