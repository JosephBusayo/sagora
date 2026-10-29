import "server-only";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Pool, types as pgTypes, type PoolClient } from "pg";
import { toPgPlaceholders } from "./sql";

/**
 * The database, behind one asynchronous interface with two drivers behind it.
 *
 * **Set `DATABASE_URL` and it is PostgreSQL. Leave it unset and it is SQLite**, in a file under
 * ./data. Development stays on SQLite on purpose: it needs no compiler, no Python and no Visual
 * Studio build tools, so `npm install` and `npm run dev` work the same on Windows, macOS and
 * Linux with nothing running in the background. Production sets the URL.
 *
 * Everything above this file is identical either way:
 *  - **Placeholders are `?`.** The Postgres driver rewrites them to $1, $2 … so no call site is
 *    written twice, and nobody has to remember which dialect they are in.
 *  - **A transaction is a callback.** On a connection pool every statement in a transaction must
 *    run on the same connection, which `BEGIN` … `COMMIT` scattered through a function cannot
 *    guarantee and `db.tx(fn)` can.
 *  - **`run` reports `changes`**, whichever driver counted them.
 */

const url = process.env.DATABASE_URL?.trim();

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

/**
 * Values a driver accepts.
 *
 * The two engines differ here, which is why binding is per-driver: Postgres has a real boolean
 * type and Better Auth's `emailVerified` column uses it, while SQLite has no booleans at all and
 * stores 1 and 0. Sending 1 to a Postgres boolean column fails outright, so each driver converts
 * for itself and the call sites write `true`.
 */
type Bound = string | number | bigint | boolean | null | Uint8Array;
const normalise = (p: unknown): Bound => (p === undefined ? null : (p as Bound));
const bindPg = (params: unknown[]): Bound[] => params.map(normalise);
const bindSqlite = (params: unknown[]): Bound[] =>
  params.map((p) => {
    const v = normalise(p);
    return typeof v === "boolean" ? (v ? 1 : 0) : v;
  });

/* --------------------------------------------------------------- Postgres */

function postgresDriver(connectionString: string): { db: Database; auth: Pool } {
  // COUNT(*) and SUM(x) come back as Postgres `bigint`, and the driver hands bigints over as
  // *strings* so that values beyond JavaScript's safe range are not quietly rounded. SQLite
  // returns plain numbers for the same queries, and every call site above here expects a
  // number: left alone, `paid + amount` would join two strings end to end rather than add
  // them, which in a ledger is the worst kind of bug — silent and wrong.
  //
  // So bigints are converted here, once, and the conversion refuses rather than rounds. The
  // ceiling is about nine quadrillion, and amounts are held in minor units: that is roughly
  // ninety trillion Leones in one sum, which this would have to be a different business to
  // reach. If it ever is reached, this throws and says so instead of losing the cents.
  const INT8 = 20;
  pgTypes.setTypeParser(INT8, (value: string) => {
    const n = Number(value);
    if (!Number.isSafeInteger(n)) {
      throw new Error(
        `A total from the database (${value}) is too large to hold exactly as a number. ` +
          "Refusing it rather than rounding it: amounts must stay exact.",
      );
    }
    return n;
  });

  // Neon and every other managed host require TLS. `sslmode=require` in the URL covers it;
  // this is the belt to that braces, and is ignored for a plain local server.
  const pool = new Pool({
    connectionString,
    ssl: /\blocalhost\b|\b127\.0\.0\.1\b/.test(connectionString) ? undefined : { rejectUnauthorized: true },
  });

  const queriesOn = (run: (sql: string, values: Bound[]) => Promise<{ rows: unknown[]; rowCount: number | null }>): Queries => ({
    async get<T>(sql: string, ...params: unknown[]) {
      const r = await run(toPgPlaceholders(sql), bindPg(params));
      return r.rows[0] as T | undefined;
    },
    async all<T>(sql: string, ...params: unknown[]) {
      const r = await run(toPgPlaceholders(sql), bindPg(params));
      return r.rows as T[];
    },
    async run(sql: string, ...params: unknown[]) {
      const r = await run(toPgPlaceholders(sql), bindPg(params));
      return { changes: r.rowCount ?? 0 };
    },
    async exec(sql: string) {
      await run(sql, []);
    },
  });

  const db: Database = {
    ...queriesOn((sql, values) => pool.query(sql, values.length ? values : undefined)),
    async tx<T>(fn: (t: Queries) => Promise<T>): Promise<T> {
      // One connection for the whole transaction. This is the reason tx takes a callback.
      const client: PoolClient = await pool.connect();
      try {
        await client.query("BEGIN");
        try {
          const result = await fn(queriesOn((sql, values) => client.query(sql, values.length ? values : undefined)));
          await client.query("COMMIT");
          return result;
        } catch (err) {
          await client.query("ROLLBACK");
          throw err;
        }
      } finally {
        client.release();
      }
    },
  };

  return { db, auth: pool };
}

/* ----------------------------------------------------------------- SQLite */

function sqliteDriver(file: string): { db: Database; auth: DatabaseSync } {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const connection = new DatabaseSync(file);
  connection.exec("PRAGMA journal_mode = WAL");
  connection.exec("PRAGMA foreign_keys = ON");
  // Node's SQLite waits 0ms for a lock by default, so two writes at once fail outright.
  // better-sqlite3 waited 5s; keep that, or concurrent requests hit "database is locked".
  connection.exec("PRAGMA busy_timeout = 5000");

  /**
   * SQLite here is one connection, and a transaction on it belongs to whoever opened it. Because
   * the body of `tx` may await, another request's query could otherwise land in the middle of
   * someone else's transaction and be committed or rolled back with it. So operations queue: a
   * transaction holds the queue for its whole body, which is exactly what a dedicated connection
   * does on Postgres. Everything underneath is synchronous, so the queue costs nothing.
   */
  let queue: Promise<unknown> = Promise.resolve();
  function serial<T>(work: () => T): Promise<T> {
    const next = queue.then(work, work);
    queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
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

  /**
   * True while a transaction holds the queue. Reaching for the shared `db` from inside a
   * transaction body would wait for a lock that body is holding: a deadlock, and a silent one —
   * the request simply never answers. So it throws instead, naming the fix. Postgres has no
   * equivalent problem, because there the pool simply hands out another connection.
   */
  let inTransaction = false;
  function refuseInsideTransaction(sql: string): never {
    throw new Error(
      "A query used the shared `db` from inside db.tx(...), which would deadlock.\n" +
        "Use the `t` handed to the transaction body, or move the query outside it.\n" +
        `Query: ${sql.trim().split("\n")[0]}`,
    );
  }

  const direct: Queries = {
    async get<T>(sql: string, ...params: unknown[]) {
      return connection.prepare(sql).get(...(bindSqlite(params) as never[])) as T | undefined;
    },
    async all<T>(sql: string, ...params: unknown[]) {
      return connection.prepare(sql).all(...(bindSqlite(params) as never[])) as T[];
    },
    async run(sql: string, ...params: unknown[]) {
      const r = connection.prepare(sql).run(...(bindSqlite(params) as never[]));
      return { changes: Number(r.changes) };
    },
    async exec(sql: string) {
      connection.exec(sql);
    },
  };

  const db: Database = {
    get<T>(sql: string, ...params: unknown[]) {
      if (inTransaction) refuseInsideTransaction(sql);
      return serial(() => connection.prepare(sql).get(...(bindSqlite(params) as never[])) as T | undefined);
    },
    all<T>(sql: string, ...params: unknown[]) {
      if (inTransaction) refuseInsideTransaction(sql);
      return serial(() => connection.prepare(sql).all(...(bindSqlite(params) as never[])) as T[]);
    },
    run(sql: string, ...params: unknown[]) {
      if (inTransaction) refuseInsideTransaction(sql);
      return serial(() => {
        const r = connection.prepare(sql).run(...(bindSqlite(params) as never[]));
        return { changes: Number(r.changes) };
      });
    },
    async exec(sql: string) {
      if (inTransaction) refuseInsideTransaction(sql);
      await serial(() => connection.exec(sql));
    },
    async tx<T>(fn: (t: Queries) => Promise<T>): Promise<T> {
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

  return { db, auth: connection };
}

/* ------------------------------------------------------------------ wiring */

/**
 * A deployed site has no writable disk, so the SQLite fallback cannot work there: it would keep
 * sign-ups inside the deployment and lose them on the next one, or fail at the first write with
 * a read-only-file-system error that says nothing about the real mistake. So a production server
 * that was started without DATABASE_URL refuses to start at all, and says why.
 *
 * This is at import rather than on first query because Better Auth is handed the raw connection
 * and queries it directly, which a check inside this file's own wrapper would never see.
 *
 * Two exemptions. `next build` sets NEXT_PHASE and loads this file on machines that have no
 * database — a fresh clone, CI, the deploy host — and a build must never need one.
 * SAGORA_TEST_OUTBOX marks the browser tests, which run a production build against SQLite on
 * purpose.
 */
const building = process.env.NEXT_PHASE === "phase-production-build";
if (!url && process.env.NODE_ENV === "production" && !building && process.env.SAGORA_TEST_OUTBOX !== "1") {
  throw new Error(
    "DATABASE_URL is not set.\n\n" +
      "A deployed Sagora must point at PostgreSQL: the SQLite fallback is for local development " +
      "only, and a hosted site has no disk to keep it on. Set DATABASE_URL in the host's " +
      "environment settings to the connection string from Neon, then deploy again.",
  );
}

const driver = url
  ? postgresDriver(url)
  : sqliteDriver(process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "sagora.db"));

/** Which engine is in use. Shown by the migration script so nobody migrates the wrong database. */
export const engine: "postgres" | "sqlite" = url ? "postgres" : "sqlite";

/** Where it is, with any password removed — safe to print. */
export const describe = (): string =>
  url ? `postgres ${new URL(url).host}${new URL(url).pathname}` : `sqlite ${process.env.DATABASE_PATH ?? "data/sagora.db"}`;

/**
 * The driver object itself, for Better Auth alone: it takes a `pg` Pool or a DatabaseSync and
 * manages its own four tables. Application code uses `db`.
 */
export const authConnection = driver.auth;

const inner = driver.db;

/**
 * The schema is not created from application code: it lives in /migrations, applied by
 * `npm run db:migrate`. The first query against a database that has never been migrated says
 * exactly that, rather than failing later with "no such table: quote" halfway through a page.
 *
 * On first USE, not on import: `next build` loads this file on machines that have no database
 * at all — a fresh clone, CI, a deploy host — and a build must never need one.
 */
let checked = false;
async function assertMigrated() {
  if (checked) return;

  if (process.env.SAGORA_SKIP_SCHEMA_CHECK === "1") {
    checked = true;
    return;
  }
  const row = await inner.get<{ found: unknown }>(
    engine === "postgres"
      ? "SELECT to_regclass('public.schema_migrations') AS found"
      : "SELECT name AS found FROM sqlite_master WHERE type='table' AND name='schema_migrations'",
  );
  if (!row?.found) {
    throw new Error(`This database has no schema. Run \`npm run db:migrate\` first.\nDatabase: ${describe()}`);
  }
  checked = true;
}

export const db: Database = {
  async get<T>(sql: string, ...params: unknown[]) {
    await assertMigrated();
    return inner.get<T>(sql, ...params);
  },
  async all<T>(sql: string, ...params: unknown[]) {
    await assertMigrated();
    return inner.all<T>(sql, ...params);
  },
  async run(sql: string, ...params: unknown[]) {
    await assertMigrated();
    return inner.run(sql, ...params);
  },
  async exec(sql: string) {
    await assertMigrated();
    return inner.exec(sql);
  },
  async tx<T>(fn: (t: Queries) => Promise<T>) {
    await assertMigrated();
    return inner.tx(fn);
  },
};
