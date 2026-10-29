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

async function ensureTable() {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      checksum TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
}

export async function pending(): Promise<string[]> {
  await ensureTable();
  const rows = await db.all<{ name: string }>("SELECT name FROM schema_migrations");
  const done = new Set(rows.map((r) => r.name));
  return files().filter((f) => !done.has(f));
}

function files(): string[] {
  if (!fs.existsSync(DIR)) return [];
  return fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
}

export async function migrate(log: (line: string) => void = () => {}): Promise<Applied[]> {
  await ensureTable();

  const rows = await db.all<{ name: string; checksum: string }>("SELECT name, checksum FROM schema_migrations");
  const recorded = new Map(rows.map((r) => [r.name, r.checksum] as const));

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
    try {
      await db.tx(async (t) => {
        // A migration file is many statements, so it goes in whole rather than one at a time.
        await t.exec(sql);
        await t.run(
          "INSERT INTO schema_migrations (name, checksum, applied_at) VALUES (?,?,?)",
          name,
          sum,
          new Date().toISOString(),
        );
      });
    } catch (err) {
      throw new Error(`${name} failed and was rolled back: ${(err as Error).message}`);
    }
    results.push({ name, already: false });
  }
  return results;
}
