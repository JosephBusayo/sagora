// Empties a database of its data and leaves the schema standing.
// Run: npm run db:reset -- --yes
//
// This is for clearing out test accounts, requests and payments between rounds of
// testing. It is deliberately awkward to run by accident: it prints the database it
// is about to empty and refuses to do anything without --yes on the command line.
//
// It never drops tables, so migrations do not need to run again afterwards.
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";

const { preferDirectConnection } = await import("./direct-connection.mjs");
preferDirectConnection();

const { db, engine, describe } = await import("../src/lib/db");

const confirmed = process.argv.includes("--yes");

console.log(`Database: ${describe()}`);

// A database someone has marked as production is never emptied by this script, confirmed
// or not. The flag is set on the host, next to the connection string, so the guard travels
// with the database rather than with whoever is running the command.
if (process.env.SAGORA_ENV === "production") {
  console.error(
    "\nThis database is marked SAGORA_ENV=production, so it will not be emptied.\n" +
      "If you really mean to clear production data, do it deliberately and by hand.",
  );
  process.exit(1);
}

if (!confirmed) {
  console.error(
    "\nThis will delete every account, request, quote, booking, payment and ledger\n" +
      "entry in the database named above. The schema stays, so there is nothing to\n" +
      "migrate afterwards.\n\n" +
      "Nothing has been deleted. To go ahead, run it again with --yes:\n" +
      "  npm run db:reset -- --yes",
  );
  process.exit(1);
}

// Find the tables from the database itself rather than from a list kept here, so a table
// added later is cleared too and no one has to remember to update this file.
// schema_migrations is the record of what has been applied and must survive.
const KEEP = new Set(["schema_migrations"]);

const tables = (
  engine === "postgres"
    ? await db.all<{ name: string }>(
        `SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`,
      )
    : await db.all<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      )
).map((t) => t.name).filter((t) => !KEEP.has(t));

if (tables.length === 0) {
  console.error("\nThere are no tables to empty. Has this database been migrated?");
  process.exit(1);
}

if (engine === "postgres") {
  // One statement, so the tables come back empty together and no foreign key or trigger
  // sees a half-cleared database in between.
  const quoted = tables.map((t) => `"${t}"`).join(", ");
  await db.exec(`TRUNCATE ${quoted} RESTART IDENTITY CASCADE`);
} else {
  await db.tx(async (t) => {
    for (const table of tables) await t.run(`DELETE FROM "${table}"`);
  });
  await db.exec("VACUUM");
}

console.log(`\nEmptied ${tables.length} tables. The schema is untouched.`);
console.log("Sign-up starts from nothing on the next request.");
