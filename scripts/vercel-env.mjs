// Pushes this project's production environment into Vercel, from .env.local.
//
//   npm run vercel:env            add the variables
//   npm run vercel:env -- --replace   overwrite any that are already there
//   npm run vercel:env -- --dry       print what it would do and change nothing
//
// Run it after `vercel login` and `vercel link`. It exists because seven variables typed by
// hand into a web form is seven chances to mangle a connection string, and because which
// variables belong in production is a decision worth recording rather than remembering.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const replace = args.includes("--replace");
const dry = args.includes("--dry");
const TARGET = "production";

/** Copied from .env.local as-is. */
const COPY = ["CENTRAL_LICENSE_KEY", "DATABASE_URL", "DATABASE_URL_UNPOOLED", "RESEND_API_KEY"];

/** Set here rather than copied, with the reason. */
const FIXED = {
  // Stops `npm run db:reset` from emptying this database, however the command is run.
  SAGORA_ENV: TARGET,
};

/**
 * Deliberately not copied.
 * - BETTER_AUTH_SECRET: a development secret must not become the production one. Minted fresh.
 * - BETTER_AUTH_URL: has to match the address people actually visit, which is not known until
 *   the first deploy. Set after, then redeploy.
 * - EMAIL_FROM: unset falls back to Resend's own sender, which needs no DNS. Set it to the
 *   real address once the domain verifies.
 * - NEON_BRANCH: written by `neon env pull` for the reader's benefit; nothing reads it.
 * - DATABASE_PATH / SAGORA_TEST_OUTBOX: SQLite and test-only. On a deployed site they do
 *   nothing good, and SAGORA_TEST_OUTBOX would skip the email provider entirely.
 */
const SKIP = ["BETTER_AUTH_SECRET", "BETTER_AUTH_URL", "EMAIL_FROM", "NEON_BRANCH", "DATABASE_PATH", "SAGORA_TEST_OUTBOX"];

/** Minimal .env reader: KEY=value, ignoring blanks and whole-line comments. */
function readEnvFile(file) {
  if (!fs.existsSync(file)) return null;
  const out = {};
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    // Everything after the first "=" is the value, quotes trimmed if they wrap the whole thing.
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (value) out[key] = value;
  }
  return out;
}

const file = path.join(process.cwd(), ".env.local");
const env = readEnvFile(file);
if (!env) {
  console.error("No .env.local here. Run this from the project folder, after `neon env pull`.");
  process.exit(1);
}

function vercel(cmdArgs, input) {
  if (dry) return { status: 0, stdout: "(dry run)" };
  return spawnSync("vercel", cmdArgs, {
    input,
    encoding: "utf8",
    shell: process.platform === "win32",
  });
}

// A linked project is required; say so plainly rather than letting each add fail in turn.
if (!dry && !fs.existsSync(path.join(process.cwd(), ".vercel", "project.json"))) {
  console.error("This folder is not linked to a Vercel project yet.\n\n  vercel login\n  vercel link\n\nThen run this again.");
  process.exit(1);
}

const plan = [];
for (const key of COPY) {
  if (env[key]) plan.push({ key, value: env[key], note: "from .env.local" });
  else plan.push({ key, value: null, note: "MISSING from .env.local" });
}
for (const [key, value] of Object.entries(FIXED)) plan.push({ key, value, note: "set by this script" });
plan.push({
  key: "BETTER_AUTH_SECRET",
  value: crypto.randomBytes(32).toString("hex"),
  note: "newly generated — deliberately not your local one",
});

console.log(`Environment: ${TARGET}${dry ? "   (dry run — nothing will change)" : ""}\n`);

let failed = 0;
for (const { key, value, note } of plan) {
  if (!value) {
    console.log(`  skip    ${key.padEnd(22)} ${note}`);
    failed++;
    continue;
  }
  if (replace) vercel(["env", "rm", key, TARGET, "--yes"], "");
  const r = vercel(["env", "add", key, TARGET], value + "\n");
  if (r.status === 0) {
    console.log(`  added   ${key.padEnd(22)} ${note}`);
  } else {
    const why = String(r.stderr || r.stdout || "").trim().split("\n").pop();
    console.log(`  failed  ${key.padEnd(22)} ${why}`);
    failed++;
  }
}

console.log(`\nNot set, on purpose: ${SKIP.filter((k) => k !== "BETTER_AUTH_SECRET").join(", ")}`);
console.log(
  "\nNext:\n" +
    "  1. vercel --prod            deploy\n" +
    "  2. take the URL it prints, then:\n" +
    "     vercel env add BETTER_AUTH_URL production     (paste https://your-url, no trailing slash)\n" +
    "  3. vercel --prod            deploy again, so sign-in cookies land on the right origin\n",
);

if (failed) {
  console.log(`${failed} variable${failed === 1 ? "" : "s"} did not get set. Fix those before deploying.`);
  process.exit(1);
}
