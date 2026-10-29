// Brings a database up to date: Better Auth's own tables first, then our numbered SQL files.
// Run: npm run db:migrate
//
// The schema check in lib/db.ts refuses to open a database that has never been migrated. This
// script is the one thing that must run before that is true, so it turns the check off for
// itself — before importing anything that opens the database, which is why the imports below
// are dynamic rather than at the top.
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";

const { getMigrations } = await import("better-auth/db/migration");
const { auth } = await import("../src/lib/auth");
const { migrate } = await import("../src/lib/migrate");

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
  const applied = migrate((line) => console.log(line));
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
