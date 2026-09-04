import fs from "node:fs";
import { sha256Hex } from "@codex-tracker/shared";

export interface SqliteStatement {
  all(...params: unknown[]): Array<Record<string, unknown>>;
  iterate?(...params: unknown[]): IterableIterator<Record<string, unknown>>;
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  close(): void;
}

interface SqliteModule {
  DatabaseSync: new (file: string, options?: { readOnly?: boolean }) => SqliteDatabase;
}

function sqliteModule(): SqliteModule | null {
  try {
    // Dynamic by design: Node 16/20 builds keep working and use non-SQLite fallbacks.
    return require("node:sqlite") as SqliteModule;
  } catch {
    return null;
  }
}

export function hasNodeSqlite(): boolean {
  return sqliteModule() !== null;
}

/** Best-effort probe for discovery code, where an unreadable database means "not this source". */
export function openSqliteReadOnly(file: string): SqliteDatabase | null {
  try {
    return openSqliteReadOnlyOrThrow(file);
  } catch {
    return null;
  }
}

/**
 * Open a database for parsing. A missing SQLite runtime is an unsupported capability (`null`),
 * while an operational open failure is thrown so SessionStore can retain its last good snapshot.
 */
export function openSqliteReadOnlyOrThrow(file: string): SqliteDatabase | null {
  const sqlite = sqliteModule();
  if (!sqlite) return null;
  return new sqlite.DatabaseSync(file, { readOnly: true });
}

/** Best-effort table probe used while choosing between alternate durable stores. */
export function sqliteTableNames(db: SqliteDatabase): Set<string> {
  try {
    return sqliteTableNamesOrThrow(db);
  } catch {
    return new Set();
  }
}

/** Query tables during parsing, preserving query failures for SessionStore's retry path. */
export function sqliteTableNamesOrThrow(db: SqliteDatabase): Set<string> {
  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  return new Set(rows.map((row) => String(row.name ?? "")).filter(Boolean));
}

/** Stream potentially large result sets when the runtime supports it; test shims can fall back to `all()`. */
export function sqliteRows(db: SqliteDatabase, sql: string, ...params: unknown[]): Iterable<Record<string, unknown>> {
  const statement = db.prepare(sql);
  return statement.iterate ? statement.iterate(...params) : statement.all(...params);
}

/** Stable, non-reversible identity for a source DB without exposing its local path. */
export function sqliteSessionId(agent: string, file: string): string {
  return `${agent}-db-${sha256Hex(`${agent}:${file}`).slice(0, 16)}`;
}

/** Include SQLite's write-ahead log so an unchanged main DB is still re-parsed after new rows. */
export function sqliteFileVersion(file: string, main: fs.Stats): { size: number; mtimeMs: number } {
  try {
    const wal = fs.statSync(`${file}-wal`);
    return { size: main.size + wal.size, mtimeMs: Math.max(main.mtimeMs, wal.mtimeMs) };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "ENOENT" && code !== "ENOTDIR") throw error;
    return { size: main.size, mtimeMs: main.mtimeMs };
  }
}
