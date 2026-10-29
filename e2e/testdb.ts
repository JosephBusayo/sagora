import { DatabaseSync } from "node:sqlite";
import { Pool } from "pg";
import path from "node:path";
import { toPgPlaceholders } from "../src/lib/sql";

/**
 * The test database, as the app sees it.
 *
 * Tests reach past the browser for two honest reasons: to promote an account to staff (there is
 * deliberately no public way to do that) and to set up a state the UI cannot reach, such as a
 * notification that has already failed five times.
 *
 * It follows the same rule as the application: `DATABASE_URL` means PostgreSQL, and no
 * `DATABASE_URL` means the SQLite file. So the whole suite can be run against either engine,
 * which is the only way to know the Postgres driver really works.
 */

const url = process.env.DATABASE_URL?.trim();

let pool: Pool | null = null;
let sqlite: DatabaseSync | null = null;

function lite(): DatabaseSync {
  if (!sqlite) {
    sqlite = new DatabaseSync(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "test.db"));
    // The server holds the write lock while it works, and node:sqlite waits 0ms by default,
    // so without this a test write fails outright with "database is locked".
    sqlite.exec("PRAGMA busy_timeout = 5000");
  }
  return sqlite;
}

const pg = (): Pool => (pool ??= new Pool({ connectionString: url, max: 4 }));

export async function testAll<T>(sql: string, ...params: unknown[]): Promise<T[]> {
  if (url) return (await pg().query(toPgPlaceholders(sql), params)).rows as T[];
  return lite().prepare(sql).all(...(params as never[])) as T[];
}

export async function testGet<T>(sql: string, ...params: unknown[]): Promise<T | undefined> {
  return (await testAll<T>(sql, ...params))[0];
}

export async function testRun(sql: string, ...params: unknown[]): Promise<{ changes: number }> {
  if (url) {
    const r = await pg().query(toPgPlaceholders(sql), params);
    return { changes: r.rowCount ?? 0 };
  }
  const r = lite().prepare(sql).run(...(params as never[]));
  return { changes: Number(r.changes) };
}

/** Closes whatever was opened. Playwright leaves the process otherwise hanging on the pool. */
export async function closeTestDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
  if (sqlite) {
    sqlite.close();
    sqlite = null;
  }
}
