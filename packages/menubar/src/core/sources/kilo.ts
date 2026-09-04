import fs from "node:fs";
import path from "node:path";
import { emptyUsage, isCanonicalTokenUsage, isCodexAuthProvider, tryAddUsageInPlace, type ParsedSession, type TokenUsage, type UsageEvent } from "@codex-tracker/shared";
import type { ParseOptions, SessionRoot, SourceContext, SourceDefinition, SourceFile, UserHome } from "./types";
import { kiloSource as legacyKiloSource } from "./cline";
import { isFile, makeRoot, MAX_AUTH_METADATA_BYTES, readUtf8FileLimited } from "./util";
import { openSqliteReadOnlyOrThrow, sqliteFileVersion, sqliteRows, sqliteSessionId, sqliteTableNamesOrThrow } from "./sqlite";

type AuthTypes = Record<string, string>;
type KiloRoot = SessionRoot & { authFile?: string; authTypesOverride?: AuthTypes; authTypesInvalid?: boolean };

interface KiloMessage {
  id?: string;
  sessionID?: string;
  role?: string;
  type?: string;
  modelID?: string;
  providerID?: string;
  model?: { id?: string; modelID?: string; providerID?: string };
  time?: { created?: number; completed?: number };
  tokens?: {
    total?: number;
    input?: number;
    output?: number;
    reasoning?: number;
    cache?: { read?: number; write?: number };
  };
}

function kiloDataDir(h: UserHome, env: NodeJS.ProcessEnv): string {
  if (h.layout === "win32") {
    const dataHome = h.origin === "local" && env.LOCALAPPDATA
      ? env.LOCALAPPDATA
      : path.join(h.home, "AppData", "Local");
    return path.join(dataHome, "kilo");
  }
  if (h.layout === "darwin") return path.join(h.home, "Library", "Application Support", "kilo");
  const dataHome = h.origin === "local" && env.XDG_DATA_HOME
    ? env.XDG_DATA_HOME
    : path.join(h.home, ".local", "share");
  return path.join(dataHome, "kilo");
}

function explicitDatabase(dataDir: string, env: NodeJS.ProcessEnv, local: boolean): string | null {
  const configured = local ? env.KILO_DB?.trim() : undefined;
  if (!configured) return null;
  if (configured === ":memory:") return null;
  return path.isAbsolute(configured) ? configured : path.join(dataDir, configured);
}

function kiloDatabases(dataDir: string): string[] {
  try {
    const names = fs
      .readdirSync(dataDir, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name);
    const current = new Map<string, string>();
    const legacy = new Map<string, string>();
    for (const name of names) {
      const match = /^(kilo|opencode)(-[a-z0-9._-]+)?\.db$/i.exec(name);
      if (!match) continue;
      const channel = (match[2] ?? "").toLowerCase();
      (match[1].toLowerCase() === "kilo" ? current : legacy).set(channel, name);
    }
    return [
      ...[...current.values()].sort(),
      ...[...legacy].filter(([channel]) => !current.has(channel)).map(([, name]) => name).sort(),
    ].map((name) => path.join(dataDir, name));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") return [];
    throw error;
  }
}

function authTypes(value: unknown): AuthTypes {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const types: AuthTypes = {};
  for (const [provider, auth] of Object.entries(value)) {
    if (!auth || typeof auth !== "object" || Array.isArray(auth)) continue;
    const type = (auth as { type?: unknown }).type;
    if (typeof type === "string") types[provider.toLowerCase()] = type.toLowerCase();
  }
  return types;
}

function parseAuthTypes(text: string): AuthTypes | null {
  try {
    return authTypes(JSON.parse(text));
  } catch {
    return null;
  }
}

function readAuthTypes(file: string | undefined): { types: AuthTypes; invalid: boolean } {
  if (!file) return { types: {}, invalid: false };
  try {
    const types = parseAuthTypes(readUtf8FileLimited(file));
    return types ? { types, invalid: false } : { types: {}, invalid: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    return code === "ENOENT" || code === "ENOTDIR"
      ? { types: {}, invalid: false }
      : { types: {}, invalid: true };
  }
}

function rootAuthTypes(root: KiloRoot): AuthTypes {
  const result = root.authTypesOverride
    ? { types: root.authTypesOverride, invalid: false }
    : root.authTypesInvalid
      ? { types: {}, invalid: true }
      : readAuthTypes(root.authFile);
  if (result.invalid) {
    root.oauthAttribution = "unknown";
    throw new Error("Invalid or unreadable Kilo auth metadata");
  }
  const types = result.types;
  const openai = types.openai;
  root.oauthAttribution = openai === "oauth" ? "oauth" : "non-oauth";
  return types;
}

function authFingerprint(root: KiloRoot): number {
  let types: AuthTypes;
  try {
    types = rootAuthTypes(root);
  } catch {
    types = {};
  }
  const entries = Object.entries(types).sort(([a], [b]) => a.localeCompare(b));
  let hash = 2_166_136_261;
  for (const char of JSON.stringify(entries)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return hash >>> 0;
}

function tokenCount(value: unknown): number | null {
  if (value === undefined) return 0;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function tokenUsage(tokens: KiloMessage["tokens"]): TokenUsage | null {
  if (!tokens) return null;
  const freshInput = tokenCount(tokens.input);
  const visibleOutput = tokenCount(tokens.output);
  const cached = tokenCount(tokens.cache?.read);
  const cacheWrite = tokenCount(tokens.cache?.write);
  const reasoning = tokenCount(tokens.reasoning);
  const reportedTotal = tokenCount(tokens.total);
  if (
    freshInput === null
    || visibleOutput === null
    || cached === null
    || cacheWrite === null
    || reasoning === null
    || reportedTotal === null
  ) return null;
  const input = freshInput + cached + cacheWrite;
  const output = visibleOutput + reasoning;
  const recombinedTotal = input + output;
  if (!Number.isSafeInteger(input) || !Number.isSafeInteger(output) || !Number.isSafeInteger(recombinedTotal)) return null;
  const total = tokens.total === undefined || reportedTotal < recombinedTotal ? recombinedTotal : reportedTotal;
  const usage = { input, cached, cacheWrite, output, reasoning, total, requests: 1 };
  return isCanonicalTokenUsage(usage) ? usage : null;
}

function timestamp(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function parseKiloDatabase(file: SourceFile, opts: ParseOptions): ParsedSession | null {
  const db = openSqliteReadOnlyOrThrow(file.path);
  if (!db) return null;
  const events: UsageEvent[] = [];
  const cumulative = emptyUsage();
  let lineCount = 0;
  try {
    const tables = sqliteTableNamesOrThrow(db);
    const supportedTables: Array<{ table: string; typeColumn: string }> = [];
    // `session_message` is the current schema. Process it first so its row wins when a migration
    // leaves the same message id in the legacy `message` table.
    for (const table of ["session_message", "message"]) {
      if (!tables.has(table)) continue;
      const columns = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((column) => String(column.name ?? "")));
      if (!["id", "session_id", "data"].every((column) => columns.has(column))) continue;
      supportedTables.push({ table, typeColumn: columns.has("type") ? ", type" : "" });
    }
    if (!supportedTables.length) return null;
    const root = file.root as KiloRoot;
    const currentAuthTypes = rootAuthTypes(root);
    const seenMessageIds = new Set<string>();
    for (const { table, typeColumn } of supportedTables) {
      for (const row of sqliteRows(db, `SELECT id, session_id${typeColumn}, data FROM ${table}`)) {
        const messageId = row.id == null ? `${table}:${lineCount}` : String(row.id);
        if (seenMessageIds.has(messageId)) continue;
        seenMessageIds.add(messageId);
        lineCount++;
        let message: KiloMessage;
        try {
          message = JSON.parse(String(row.data ?? "")) as KiloMessage;
        } catch {
          continue;
        }
        if (!message.type && typeof row.type === "string") message.type = row.type;
        if (message.role !== "assistant" && message.type !== "assistant") continue;
        if (!message.tokens) continue;
        const provider = message.providerID ?? message.model?.providerID ?? null;
        const codexOauth = isCodexAuthProvider(provider)
          || (provider?.toLowerCase() === "openai" && currentAuthTypes.openai === "oauth");
        if (!opts.includeAllProviders && !codexOauth) continue;
        const usage = tokenUsage(message.tokens);
        if (!usage || (usage.total <= 0 && usage.input <= 0 && usage.output <= 0)) continue;
        if (!tryAddUsageInPlace(cumulative, usage)) continue;
        events.push({
          ts: timestamp(message.time?.completed) || timestamp(message.time?.created),
          model: message.modelID ?? message.model?.modelID ?? message.model?.id ?? "unknown",
          agent: file.root.agent,
          provider: codexOauth ? "openai-codex" : provider,
          usage,
        });
      }
    }
  } finally {
    try {
      db.close();
    } catch {
      /* ignore */
    }
  }

  events.sort((a, b) => a.ts - b.ts);
  const first = events[0];
  const last = events[events.length - 1];
  return {
    sessionId: sqliteSessionId(file.root.agent, file.path),
    agent: file.root.agent,
    provider: last?.provider ?? null,
    startedAt: first?.ts ?? 0,
    lastActivityAt: last?.ts ?? 0,
    cwd: null,
    projectName: null,
    originator: file.root.agent,
    source: file.root.agent,
    cliVersion: null,
    timezone: null,
    model: last?.model ?? "unknown",
    events,
    cumulative,
    contextWindow: null,
    rateLimits: null,
    lineCount,
  };
}

/** Current Kilo CLI SQLite store plus the older VS Code Cline-format task store. */
export const kiloSource: SourceDefinition = {
  id: "kilo",
  label: "Kilo Code",
  format: "cline",
  discover(ctx: SourceContext): SessionRoot[] {
    const roots = legacyKiloSource.discover(ctx);
    for (const h of ctx.homes) {
      const dataDir = kiloDataDir(h, ctx.env);
      const explicit = explicitDatabase(dataDir, ctx.env, h.origin === "local");
      const databases = explicit ? (isFile(explicit) ? [explicit] : []) : kiloDatabases(dataDir);
      for (const database of databases) {
        const root = makeRoot(path.dirname(database), "kilo", "kilo", "cline", "flat", h.origin, [path.basename(database)], 0, false) as KiloRoot;
        root.authFile = path.join(dataDir, "auth.json");
        if (h.origin === "local" && ctx.env.KILO_AUTH_CONTENT?.trim()) {
          // Keep only non-secret provider/type discriminators from the higher-precedence environment override.
          const content = ctx.env.KILO_AUTH_CONTENT;
          const override = Buffer.byteLength(content, "utf8") <= MAX_AUTH_METADATA_BYTES
            ? parseAuthTypes(content)
            : null;
          if (override) root.authTypesOverride = override;
          else root.authTypesInvalid = true;
        }
        roots.push(root);
      }
    }
    return roots;
  },
  hotDirs: (root) => (root.text ? legacyKiloSource.hotDirs(root) : [root.dir]),
  watchRecursively: (root) => (root.text ? legacyKiloSource.watchRecursively(root) : false),
  fileVersion(file, stat, root) {
    if (root.text) return { size: stat.size, mtimeMs: stat.mtimeMs };
    const version = sqliteFileVersion(file, stat);
    return { size: version.size + authFingerprint(root as KiloRoot), mtimeMs: version.mtimeMs };
  },
  parse: (file, opts) => (file.root.text ? legacyKiloSource.parse(file, opts) : parseKiloDatabase(file, opts)),
  extraRoot: (dir, agent) => legacyKiloSource.extraRoot(dir, agent),
};
