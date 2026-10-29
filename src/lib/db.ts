import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

/**
 * The database, behind an asynchronous interface.
 *
 * Node's own SQLite is used in development on purpose: it needs no compiler, no Python and no
 * Visual Studio build tools, so `npm install` works the same on Windows, macOS and Linux.
 *
 * It is also synchronous, and every PostgreSQL driver is not. Rather than leave that difference
 * to be discovered at the end, the whole application already talks to the shape Postgres needs:
 * `await db.get(...)`, `await db.run(...)`, and transactions as `db.tx(...)`. The promises
 * below happen to settle immediately. When the Postgres driver arrives, this file changes and
 * nothing else does.
 *
 * Two details that exist for the same reason:
 *  - **Placeholders stay `?`.** The Postgres adapter will rewrite them to $1, $2 … so that no
 *    call site has to be touched twice.
 *  - **A transaction is a callback, not a pair of statements.** On a connection pool every
 *    statement in a transaction has to run on the same connection, which `BEGIN` … `COMMIT`
 *    sprinkled through a function cannot guarantee and `db.tx(fn)` can.
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
 * The real connection, for Better Auth alone: it needs the driver object itself, not the
 * interface below. Better Auth owns and migrates its own four tables. On Postgres it will be
 * handed its own pool, which is also when it stops sharing this connection's transactions.
 */
export const authConnection = connection;

/** What a statement reports back. `changes` is a number here and a bigint elsewhere. */
export type RunResult = { changes: number };

export type Queries = {
  get<T>(sql: string, ...params: unknown[]): Promise<T | undefined>;
  all<T>(sql: string, ...params: unknown[]): Promise<T[]>;
  run(sql: string, ...params: unknown[]): Promise<RunResult>;
  /** Several statements at once, with no parameters — migration files, mostly. */
  exec(sql: string): Promise<void>;
};

export type Database = Queries & {
  /**
   * Runs `fn` inside one transaction. It commits when `fn` returns and rolls back if it throws,
   * so a half-finished change cannot survive. Everything inside must use the `t` handed to it.
   */
  tx<T>(fn: (t: Queries) => Promise<T>): Promise<T>;
};

/** Values this driver accepts. Booleans are not among them, so they go in as 0 and 1. */
type Bound = string | number | bigint | null | Uint8Array;
const bind = (params: unknown[]): Bound[] =>
  params.map((p) => {
    if (p === undefined || p === null) return null;
    if (typeof p === "boolean") return p ? 1 : 0;
    return p as Bound;
  });

/**
 * The schema is not created from application code: it lives in /migrations, applied by
 * `npm run db:migrate`. The first query against a database that has never been migrated says
 * exactly that, rather than failing later with "no such table: quote" halfway through a page.
 *
 * On first USE, not on import: `next build` loads this file on machines that have no database
 * at all — a fresh clone, CI, a deploy host — and a build must never need one.
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

/* -------------------------------------------------------------------------- */

/**
 * SQLite here is one connection, and a transaction on it belongs to whoever opened it. Because
 * the body of `tx` may await, another request's query could otherwise land in the middle of
 * someone else's transaction and be committed or rolled back with it. So operations queue: a
 * transaction holds the queue for its whole body, which is exactly what a dedicated connection
 * does on Postgres. Everything underneath is synchronous, so the queue costs nothing.
 */
let queue: Promise<unknown> = Promise.resolve();

/**
 * True while a transaction holds the queue. Reaching for the shared `db` from inside a
 * transaction body would wait for a lock that body is holding: a deadlock, and a silent one —
 * the request simply never answers. So it throws instead, naming the fix.
 */
let inTransaction = false;
function refuseInsideTransaction(sql: string): never {
  throw new Error(
    "A query used the shared `db` from inside db.tx(...), which would deadlock.\n" +
      "Use the `t` handed to the transaction body, or move the query outside it.\n" +
      `Query: ${sql.trim().split("\n")[0]}`,
  );
}
function serial<T>(work: () => T): Promise<T> {
  const next = queue.then(work, work);
  queue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

const direct: Queries = {
  async get<T>(sql: string, ...params: unknown[]) {
    return connection.prepare(sql).get(...bind(params)) as T | undefined;
  },
  async all<T>(sql: string, ...params: unknown[]) {
    return connection.prepare(sql).all(...bind(params)) as T[];
  },
  async run(sql: string, ...params: unknown[]) {
    const r = connection.prepare(sql).run(...bind(params));
    return { changes: Number(r.changes) };
  },
  async exec(sql: string) {
    connection.exec(sql);
  },
};

export const db: Database = {
  get<T>(sql: string, ...params: unknown[]) {
    assertMigrated();
    if (inTransaction) refuseInsideTransaction(sql);
    return serial(() => connection.prepare(sql).get(...bind(params)) as T | undefined);
  },
  all<T>(sql: string, ...params: unknown[]) {
    assertMigrated();
    if (inTransaction) refuseInsideTransaction(sql);
    return serial(() => connection.prepare(sql).all(...bind(params)) as T[]);
  },
  run(sql: string, ...params: unknown[]) {
    assertMigrated();
    if (inTransaction) refuseInsideTransaction(sql);
    return serial(() => {
      const r = connection.prepare(sql).run(...bind(params));
      return { changes: Number(r.changes) };
    });
  },
  async exec(sql: string) {
    assertMigrated();
    if (inTransaction) refuseInsideTransaction(sql);
    await serial(() => connection.exec(sql));
  },
  async tx<T>(fn: (t: Queries) => Promise<T>): Promise<T> {
    assertMigrated();
    // Take the queue for the whole transaction, then run the body against the connection
    // directly so its own statements do not queue behind themselves.
    const release = await take();
    inTransaction = true;
    try {
      // IMMEDIATE takes the write lock up front: a check followed by a write — "is this machine
      // free, then commit it" — must not let another writer in between.
      connection.exec("BEGIN IMMEDIATE");
      try {
        const result = await fn(direct);
        connection.exec("COMMIT");
        return result;
      } catch (err) {
        connection.exec("ROLLBACK");
        throw err;
      }
    } finally {
      inTransaction = false;
      release();
    }
  },
};

/** Waits for the queue, then holds it until the returned function is called. */
function take(): Promise<() => void> {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  const mine = queue.then(
    () => release,
    () => release,
  );
  queue = mine.then(() => held);
  return mine;
}
