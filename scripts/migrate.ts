// Creates/updates the Better Auth tables (user, session, account, verification).
// Run: npm run db:migrate
import { getMigrations } from "better-auth/db/migration";
import { auth } from "../src/lib/auth";

async function main() {
  const { toBeCreated, toBeAdded, runMigrations } = await getMigrations(auth.options);
  if (toBeCreated.length === 0 && toBeAdded.length === 0) {
    console.log("Database is up to date.");
    return;
  }
  console.log("Creating tables:", toBeCreated.map((t) => t.table).join(", ") || "none");
  console.log("Adding columns:", toBeAdded.map((t) => t.table).join(", ") || "none");
  await runMigrations();
  console.log("Migration complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
