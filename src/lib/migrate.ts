import "server-only";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { db } from "./db";

/**
 * Applies the numbered SQL files in /migrations, in order, once each.
 *
 * The rules are the boring ones that make migrations trustworthy:
 *  - a file runs once and is then recorded; running again does nothing
 *  - each file runs inside a transaction, so a half-applied migration cannot exist
 *  - a file that has already run and has since been edited is a hard error, not a warning.
 *    Editing an applied migration means two databases that claim the same version are not the
 *    same shape, which is the single worst thing that can happen to a schema.
 */

export type Applied = { name: string; already: boolean };

const DIR = path.join(process.cwd(), "migrations");

const checksum = (sql: string) => createHash("sha256").update(sql.replace(/\r\n/g, "\n")).digest("hex");

function ensureTable() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

export function pending(): string[] {
  ensureTable();
  const done = new Set(
    (db.prepare("SELECT name FROM schema_migrations").all() as { name: string }[]).map((r) => r.name),
  );
  return files().filter((f) => !done.has(f));
}

function files(): string[] {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
}

export function migrate(log: (line: string) => void = () => {}): Applied[] {
  ensureTable();

  const recorded = new Map(
    (db.prepare("SELECT name, checksum FROM schema_migrations").all() as { name: string; checksum: string }[])
      .map((r) => [r.name, r.checksum] as const),
  );

  const results: Applied[] = [];
  for (const name of files()) {
    const sql = fs.readFileSync(path.join(DIR, name), "utf8");
    const sum = checksum(sql);
    const seen = recorded.get(name);

    if (seen !== undefined) {
      if (seen !== sum) {
        throw new Error(
          `${name} has already been applied but its contents have changed.\n` +
            `An applied migration is history and must never be edited — two databases would ` +
            `claim the same version and not match.\n` +
            `Put the change in a new numbered file instead.`,
        );
      }
      results.push({ name, already: true });
      continue;
    }

    log(`applying ${name}`);
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(sql);
      db.prepare("INSERT INTO schema_migrations (name, checksum, applied_at) VALUES (?,?,?)")
        .run(name, sum, new Date().toISOString());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw new Error(`${name} failed and was rolled back: ${(err as Error).message}`);
    }
    results.push({ name, already: false });
  }
  return results;
}
