// Runs the browser tests on a throwaway database.
// Node, not shell, so it behaves the same on Windows, macOS and Linux.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DB = "data/test.db";
const postgres = Boolean(process.env.DATABASE_URL);

// The outbox is a file either way; the database is a file only on sqlite.
fs.rmSync(path.join(process.cwd(), "data/dev-outbox.jsonl"), { force: true });
if (!postgres) {
  for (const f of [DB, `${DB}-wal`, `${DB}-shm`]) fs.rmSync(path.join(process.cwd(), f), { force: true });
}

function run(cmd, args, env) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const tsx = ["tsx", "--conditions", "react-server", "--env-file-if-exists=.env.local"];

run("node", ["scripts/check-sql.mjs"]);
run("npx", ["next", "build"]);
run("npx", [...tsx, "scripts/migrate.mts"], { DATABASE_PATH: DB });
// Postgres has no file to delete, so the tables are emptied instead. The tests assume a
// database with nothing in it: leftover accounts from a previous run change what they see.
if (postgres) run("npx", [...tsx, "scripts/reset.mts", "--yes"], { DATABASE_PATH: DB });
run("npx", ["playwright", "test"]);
