// Runs the money checks against a throwaway database, so a real one is never touched.
// Node, not shell, so it behaves the same on Windows, macOS and Linux.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = path.join(os.tmpdir(), "sagora-money");
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const env = {
  DATABASE_PATH: path.join(dir, "money.db"),
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "money-check-secret",
};

function run(args) {
  const r = spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// The user table comes from Better Auth's own migration, so create it the same way the app does.
run(["tsx", "--conditions", "react-server", "scripts/migrate.mts"]);
run(["tsx", "--conditions", "react-server", "scripts/check-money.mts"]);
