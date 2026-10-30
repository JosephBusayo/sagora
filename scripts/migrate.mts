// Brings a database up to date: Better Auth's own tables first, then our numbered SQL files.
// Run: npm run db:migrate
//
// The schema check in lib/db.ts refuses to open a database that has never been migrated. This
// script is the one thing that must run before that is true, so it turns the check off for
// itself — before importing anything that opens the database, which is why the imports below
// are dynamic rather than at the top.
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";

// .env.local is optional as far as the command line is concerned, so say plainly what is
// missing rather than letting Better Auth fail later with something cryptic.
if (!process.env.BETTER_AUTH_SECRET) {
  console.error(
    "BETTER_AUTH_SECRET is not set, so sign-in cannot work.\n\n" +
      "Create your local settings file and put a random value in it:\n" +
      "  Windows (cmd):  copy .env.example .env.local\n" +
      "  macOS / Linux:  cp .env.example .env.local\n\n" +
      "Then generate a secret and paste it after BETTER_AUTH_SECRET=\n" +
      '  node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"',
  );
  process.exit(1);
}

const { preferDirectConnection } = await import("./direct-connection.mjs");
preferDirectConnection();

const { getMigrations } = await import("better-auth/db/migration");
const { auth } = await import("../src/lib/auth");
const { migrate } = await import("../src/lib/migrate");
const { describe } = await import("../src/lib/db");

console.log(`Database: ${describe()}`);

// Better Auth owns user, session, account and verification, and manages them itself.
const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
if (toBeCreated.length === 0 && toBeAdded.length === 0) {
  console.log("Sign-in tables are up to date.");
} else {
  console.log("Sign-in tables — creating:", toBeCreated.map((t) => t.table).join(", ") || "none");
  console.log("Sign-in tables — adding columns:", toBeAdded.map((t) => t.table).join(", ") || "none");
  await runMigrations();
}

// Everything else lives in /migrations.
try {
  const applied = await migrate((line) => console.log(line));
  const fresh = applied.filter((a) => !a.already);
  console.log(
    fresh.length === 0
      ? `Schema is up to date (${applied.length} migration${applied.length === 1 ? "" : "s"} already applied).`
      : `Applied ${fresh.length} migration${fresh.length === 1 ? "" : "s"}.`,
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
