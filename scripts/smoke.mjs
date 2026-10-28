// Builds the app, starts it on port 3200 with a throwaway database, walks the whole product
// through a browser, then stops the server. One command on any platform.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const PORT = 3200;
const DB = "data/smoke.db";
const win = process.platform === "win32";
const env = {
  ...process.env,
  DATABASE_PATH: DB,
  BETTER_AUTH_URL: `http://localhost:${PORT}`,
  BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "smoke-secret-smoke-secret-smoke-1234",
  SAGORA_TEST_OUTBOX: "1",
};

for (const f of [DB, `${DB}-wal`, `${DB}-shm`, "data/dev-outbox.jsonl"]) {
  fs.rmSync(path.join(process.cwd(), f), { force: true });
}

function step(cmd, args, extra) {
  const r = spawnSync(cmd, args, { stdio: "inherit", shell: win, env: { ...env, ...extra } });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

step("npx", ["next", "build"]);
step("npx", ["tsx", "--conditions", "react-server", "--env-file=.env.local", "scripts/migrate.ts"]);

// Refuse to run against something else already on the port: driving another server
// (pointing at another database) looks like a hang rather than a clear failure.
try {
  const res = await fetch(`http://localhost:${PORT}/provider/sign-in`, { signal: AbortSignal.timeout(2000) });
  if (res) {
    console.error(`Something is already listening on port ${PORT}. Stop it and run this again.`);
    process.exit(1);
  }
} catch {
  // Nothing there, which is what we want.
}

// Detached on POSIX so the whole group can be stopped: `next start` spawns a child of its own,
// and killing only the parent leaves that child holding port 3200 and this script's output pipe.
const server = spawn("npx", ["next", "start", "-p", String(PORT)], {
  stdio: "inherit", shell: win, env, detached: !win,
});
server.on("exit", (code) => {
  if (code !== 0 && code !== null) {
    console.error(`The server stopped with code ${code}.`);
    process.exit(code);
  }
});
const stop = () => {
  try {
    if (win) spawnSync("taskkill", ["/pid", String(server.pid), "/T", "/F"], { stdio: "ignore", shell: true });
    else process.kill(-server.pid, "SIGTERM");
  } catch {}
};
process.on("exit", stop);
process.on("SIGINT", () => { stop(); process.exit(130); });

// Wait for it to answer before driving it.
const base = `http://localhost:${PORT}/provider/sign-in`;
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try {
    const res = await fetch(base);
    up = res.ok;
  } catch {
    await new Promise((r) => setTimeout(r, 1000));
  }
}
if (!up) {
  console.error(`The server did not start on port ${PORT}.`);
  stop();
  process.exit(1);
}

const r = spawnSync("node", ["smoke.mjs"], { stdio: "inherit", shell: win, env });
stop();
process.exit(r.status ?? 1);
