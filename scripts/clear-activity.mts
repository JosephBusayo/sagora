// Empties the activity out of a database and leaves the accounts standing.
// Run: npm run db:clear-activity -- --yes
//
// Between rounds of testing, every account keeps its login and a provider keeps their
// approved business, districts, equipment, documents, team and payout details - but every
// request, quote, job, payment and notification is gone, and request numbering starts over.
//
// Unlike db:reset this one will run against production, because clearing test traffic off
// the live site is the whole point of it. It prints the database first and does nothing
// without --yes.
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";

const { preferDirectConnection } = await import("./direct-connection.mjs");
preferDirectConnection();

const { db, engine, describe } = await import("../src/lib/db");

/** Accounts, the setup that belongs to them, and the platform's own settings. */
const KEEP = [
  // Better Auth owns these: the login itself.
  "user", "account", "session", "verification",
  // What a provider set up once and should not have to do again.
  "provider_business", "provider_coverage", "team_member", "business_document",
  "equipment", "equipment_photo", "equipment_photos", "equipment_fault",
  // The machine's own record and the permissions around it. A kept machine that lost its custody
  // history, its reviewed pairings or its serial conflict would be a different machine afterwards,
  // and a provider would have to have it all verified again.
  "asset_custody", "asset_pairing", "asset_conflict", "asset_share", "asset_viewer",
  "payout_destination", "monime_phone_verification", "staff_mfa",
  // Not data: the migration record and the platform's own settings.
  "schema_migrations", "app_setting",
];

/** Everything an account did. This is what gets cleared. */
// Order matters on SQLite, where this deletes the list in reverse: a child has to be named after
// its parent so that it is emptied first.
const CLEAR = [
  "service_request", "request_operation", "routing_decision", "request_contact",
  "quote", "quote_asset", "quote_operation", "resource_hold", "agreement",
  "job", "job_asset", "booking", "booking_flag", "inspection",
  // Dated work against a machine, like any other traffic: test downtime left standing would go on
  // blocking real days on the live site.
  "asset_downtime",
  "payment", "ledger_entry", "release", "payout_request", "revenue_allocation",
  "exception_case", "monime_checkout",
  "notification_outbox", "notification_read",
  "follow_up", "guest_lookup_miss", "voice_intake", "audit_log", "staff_invite",
  // So numbering starts over at SG-1048 rather than carrying on from the test traffic.
  // (SG-1048 and not SG-1001: references count up from a base of 1047. See lib/requests.ts.)
  "reference_counter",
];

const confirmed = process.argv.includes("--yes");
console.log(`Database: ${describe()}`);

const found = (
  engine === "postgres"
    ? await db.all<{ name: string }>("SELECT tablename AS name FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename")
    : await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
).map((t) => t.name);

// Fails closed. A table nobody has classified is not quietly emptied and not quietly kept:
// whoever added it decides which it is, while they still remember.
const unknown = found.filter((t) => !KEEP.includes(t) && !CLEAR.includes(t));
if (unknown.length > 0) {
  console.error(
    `\nThese tables are in the database but not named in this script:\n  ${unknown.join("\n  ")}\n\n` +
      "Add each one to KEEP or CLEAR in scripts/clear-activity.mts, then run again.\n" +
      "Nothing has been deleted.",
  );
  process.exit(1);
}

const present = CLEAR.filter((t) => found.includes(t));
// Counted one at a time, not with Promise.all. Neon's direct endpoint - the one these tools
// deliberately use - allows far fewer concurrent connections than the pooler, and twenty-two
// at once resets the connection before anything has been read.
const counts: { table: string; rows: number }[] = [];
for (const t of present) {
  const r = await db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM "${t}"`);
  counts.push({ table: t, rows: Number(r?.n ?? 0) });
}
const total = counts.reduce((s, c) => s + c.rows, 0);

console.log("\nRows to delete:");
for (const c of counts.filter((c) => c.rows > 0)) console.log(`  ${c.table.padEnd(26)} ${String(c.rows).padStart(6)}`);
if (total === 0) console.log("  (nothing - the activity tables are already empty)");
console.log(`\n  ${"total".padEnd(26)} ${String(total).padStart(6)}`);
console.log(`\nKeeping ${KEEP.filter((t) => found.includes(t)).length} tables: accounts, provider setup and settings.`);

if (!confirmed) {
  console.error("\nNothing has been deleted. To go ahead, run it again with --yes.");
  process.exit(1);
}

if (engine === "postgres") {
  // One statement, so nothing sees a half-cleared database. No CASCADE on purpose: if a table
  // being kept turns out to point at one being cleared, this fails loudly instead of quietly
  // emptying the kept one too.
  await db.exec(`TRUNCATE ${present.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY`);
} else {
  await db.tx(async (t) => {
    for (const table of [...present].reverse()) await t.run(`DELETE FROM "${table}"`);
  });
}

console.log(`\nDeleted ${total} rows across ${present.length} tables. Every account is untouched.`);
console.log("The next request will be SG-1048.");
