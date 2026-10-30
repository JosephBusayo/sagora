// A small two-engine database handle for the smoke walkthrough.
//
// The walkthrough needs to reach past the screens a couple of times — to promote an account to
// staff, and to read back what a quote was frozen at. It must reach the same database the
// server is using: opening the SQLite file directly, as this once did, writes to a stale file
// whenever DATABASE_URL points the server at Postgres, and every staff step then fails for a
// reason that has nothing to do with the product.
//
// Test scaffolding, not application code: the app's own data layer is src/lib/db.ts.
import path from "node:path";

const url = process.env.DATABASE_URL?.trim();

/** `?` placeholders to $1, $2 … Simple on purpose: the queries here are single-line. */
const toPg = (sql) => {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
};

let handle = null;

async function open() {
  if (handle) return handle;
  if (url) {
    const { default: pg } = await import("pg");
    // COUNT and SUM arrive as strings otherwise, the same as in the application driver.
    pg.types.setTypeParser(20, (v) => Number(v));
    const pool = new pg.Pool({
      connectionString: url,
      max: 4,
      ssl: /\blocalhost\b|\b127\.0\.0\.1\b/.test(url) ? undefined : { rejectUnauthorized: true },
    });
    handle = {
      all: async (sql, ...p) => (await pool.query(toPg(sql), p)).rows,
      close: () => pool.end(),
    };
  } else {
    const { DatabaseSync } = await import("node:sqlite");
    const file = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "sagora.db");
    const db = new DatabaseSync(file);
    db.exec("PRAGMA busy_timeout = 5000");
    handle = {
      all: async (sql, ...p) => {
        const stmt = db.prepare(sql);
        // node:sqlite needs run() for statements that return nothing.
        return /^\s*(select|with)\b/i.test(sql) ? stmt.all(...p) : (stmt.run(...p), []);
      },
      close: async () => db.close(),
    };
  }
  return handle;
}

export async function all(sql, ...params) {
  return (await open()).all(sql, ...params);
}

export async function get(sql, ...params) {
  return (await all(sql, ...params))[0];
}

export async function run(sql, ...params) {
  await all(sql, ...params);
}

export async function close() {
  if (handle) await handle.close();
  handle = null;
}
