// Runs the browser tests on a throwaway database.
// Node, not shell, so it behaves the same on Windows, macOS and Linux.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DB = "data/test.db";
for (const f of [DB, `${DB}-wal`, `${DB}-shm`, "data/dev-outbox.jsonl"]) {
  fs.rmSync(path.join(process.cwd(), f), { force: true });
}

function run(cmd, args, env) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: process.platform === "win32", env: { ...process.env, ...env } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

run("npx", ["next", "build"]);
run("npx", ["tsx", "--conditions", "react-server", "--env-file-if-exists=.env.local", "scripts/migrate.mts"], { DATABASE_PATH: DB });
run("npx", ["playwright", "test"]);
