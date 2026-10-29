import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * Local development database.
 *
 * Node's own SQLite is used on purpose: it needs no compiler, no Python and no
 * Visual Studio build tools, so `npm install` works the same on Windows, macOS
 * and Linux. Production moves to Postgres (one change, in `auth.ts` and here).
 */
const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "sagora.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

const connection = new DatabaseSync(dbPath);
connection.exec("PRAGMA journal_mode = WAL");
connection.exec("PRAGMA foreign_keys = ON");
// Node's SQLite waits 0ms for a lock by default, so two writes at once fail outright.
// better-sqlite3 waited 5s; keep that, or concurrent requests hit "database is locked".
connection.exec("PRAGMA busy_timeout = 5000");

/**
 * The schema is NOT created from application code any more. It lives in /migrations as numbered
 * SQL files, applied by `npm run db:migrate`. Creating tables at import time made the schema
 * depend on which module a request happened to load first, which is a bug we actually hit.
 *
 * So the first query against a database that has never been migrated says exactly that, instead
 * of failing later with "no such table: quote" halfway through a page. The check is on first
 * USE rather than on import, because `next build` imports this file on machines that have no
 * database yet — a fresh clone, CI, a deploy host — and a build must not need one.
 */
let checked = false;
function assertMigrated() {
  if (checked) return;
  checked = true;
  if (process.env.SAGORA_SKIP_SCHEMA_CHECK === "1") return;
  const ready = connection
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_migrations'")
    .get();
  if (!ready) {
    throw new Error(`This database has no schema. Run \`npm run db:migrate\` first.\nDatabase file: ${dbPath}`);
  }
}

/**
 * The real connection, for Better Auth alone: it needs the driver object itself, not the
 * guarded wrapper below. Better Auth owns and migrates its own four tables, so it is not
 * subject to the check either way. Application code uses `db`.
 */
export const authConnection = connection;

export const db = {
  prepare: (sql: string) => {
    assertMigrated();
    return connection.prepare(sql);
  },
  exec: (sql: string) => {
    assertMigrated();
    return connection.exec(sql);
  },
};

/** `run` reports changes as a number here and as a bigint elsewhere; normalise it. */
export function changed(result: { changes: number | bigint }): number {
  return Number(result.changes);
}
