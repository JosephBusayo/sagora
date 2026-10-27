import "server-only";
import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "sagora.db");
fs.mkdirSync(path.dirname(dbPath), { recursive: true });

/** One shared connection for Better Auth and the app's own tables. */
export const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

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
