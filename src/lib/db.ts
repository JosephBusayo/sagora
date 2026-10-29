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

export const db = new DatabaseSync(dbPath);
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA foreign_keys = ON");
// Node's SQLite waits 0ms for a lock by default, so two writes at once fail outright.
// better-sqlite3 waited 5s; keep that, or concurrent requests hit "database is locked".
db.exec("PRAGMA busy_timeout = 5000");

/** `run` reports changes as a number here and as a bigint elsewhere; normalise it. */
export function changed(result: { changes: number | bigint }): number {
  return Number(result.changes);
}

// App tables. Better Auth's own tables come from `npm run db:migrate`.
// Production (Postgres) will move these to real migrations.
db.exec(`
CREATE TABLE IF NOT EXISTS provider_business (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  district TEXT NOT NULL DEFAULT '',
  town TEXT NOT NULL DEFAULT '',
  services TEXT NOT NULL DEFAULT '[]',
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','submitted','changes_requested','approved','rejected')),
  review_note TEXT NOT NULL DEFAULT '',
  submitted_at TEXT,
  reviewed_at TEXT,
  reviewed_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
/*
 * The frozen accepted quote. Its logic lives in lib/quotes.ts, but the table is created here
 * because lib/jobs.ts, lib/payments.ts and lib/settlement.ts all read it. Leaving the DDL in
 * the module that owns the logic made the schema depend on which module a request happened to
 * load first — a farmer's home screen failed on a brand-new database for exactly that reason.
 * Numbered migration files will replace all of this (see WAITING-ON).
 */
CREATE TABLE IF NOT EXISTS agreement (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  quote_id TEXT NOT NULL,
  business_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  amount_minor INTEGER NOT NULL,
  includes TEXT NOT NULL,
  start_date TEXT NOT NULL,
  accepted_by TEXT NOT NULL,
  accepted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT ''
);
`);
