// Removes the demo farmer and demo provider, and everything that belonged to them.
// Run: npm run db:delete-demo            (shows what it would delete, deletes nothing)
//      npm run db:delete-demo -- --yes   (deletes it)
//
// These are the two accounts scripts/demo-accounts.mts creates for people trying the site out.
// Once real accounts exist they are only confusing: a farmer called "Demo Farmer" in a provider's
// request list, a business called "Demo Tractors" quoting against real ones.
//
// It will run against production, because that is where the demo accounts are. It prints the
// database first, lists what it would remove, and does nothing without --yes.
//
// It refuses outright if either account has any requests or quotes against it. Deleting an
// account that has been through work or money would leave those records pointing at an account
// that no longer exists, and this script is for tidying up test logins, not for rewriting the
// books: clear the activity first (npm run db:clear-activity) and then run this.
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";

const { preferDirectConnection } = await import("./direct-connection.mjs");
preferDirectConnection();

const { db, describe } = await import("../src/lib/db");

/**
 * The accounts demo-accounts.mts creates. Kept in step with that file by hand, deliberately:
 * importing it would create the accounts as a side effect of trying to delete them.
 */
const EMAILS = ["demo.farmer@sagora.sl", "demo.provider@sagora.sl"];

const confirmed = process.argv.includes("--yes");
console.log(`Database: ${describe()}\n`);

const holes = (n: number) => Array.from({ length: n }, () => "?").join(",");

const users = await db.all<{ id: string; email: string; name: string; role: string }>(
  `SELECT id, email, name, role FROM "user" WHERE email IN (${holes(EMAILS.length)})`, ...EMAILS);

if (users.length === 0) {
  console.log("No demo accounts in this database. Nothing to do.");
  process.exit(0);
}

const userIds = users.map((u) => u.id);
const emails = users.map((u) => u.email);
for (const u of users) console.log(`Found  ${u.email}  (${u.name}, ${u.role})`);

const businesses = await db.all<{ id: string; name: string; status: string }>(
  `SELECT id, name, status FROM provider_business WHERE user_id IN (${holes(userIds.length)})`, ...userIds);
for (const b of businesses) console.log(`Found  business "${b.name}" (${b.status})`);

const businessIds = businesses.map((b) => b.id);
const equipment = businessIds.length
  ? await db.all<{ id: string; name: string }>(
      `SELECT id, name FROM equipment WHERE business_id IN (${holes(businessIds.length)})`, ...businessIds)
  : [];
const equipmentIds = equipment.map((e) => e.id);
for (const e of equipment) console.log(`Found  equipment "${e.name}"`);

/* --------------------------------------------- refuse to orphan work or money */

// Requests these accounts own: as the farmer, or as the business a private or direct one is for.
const requestWhere = [
  `farmer_id IN (${holes(userIds.length)})`,
  ...(businessIds.length
    ? [`private_to IN (${holes(businessIds.length)})`, `direct_to IN (${holes(businessIds.length)})`]
    : []),
].join(" OR ");
const requestArgs = [...userIds, ...(businessIds.length ? [...businessIds, ...businessIds] : [])];
const requests = await db.all<{ reference: string }>(
  `SELECT reference FROM service_request WHERE ${requestWhere}`, ...requestArgs);

const quotes = businessIds.length
  ? await db.all<{ id: string }>(`SELECT id FROM quote WHERE business_id IN (${holes(businessIds.length)})`, ...businessIds)
  : [];

if (requests.length > 0 || quotes.length > 0) {
  console.error(
    `\nThese accounts still have work against them: ${requests.length} request(s)` +
      `${requests.length ? ` (${requests.map((r) => r.reference).join(", ")})` : ""} and ${quotes.length} quote(s).\n\n` +
      "Deleting them now would leave those records pointing at accounts that no longer exist.\n" +
      "Clear the activity first, then delete the accounts:\n" +
      "  npm run db:clear-activity -- --yes\n" +
      "  npm run db:delete-demo -- --yes\n\n" +
      "Nothing has been deleted.",
  );
  process.exit(1);
}

/* ------------------------------------------------------------- what will go */

/** Every statement to run, child rows before the rows they point at. */
const steps: { table: string; sql: string; args: string[] }[] = [];
const add = (table: string, sql: string, args: string[]) => steps.push({ table, sql, args });

if (equipmentIds.length) {
  const h = holes(equipmentIds.length);
  add("equipment_fault", `DELETE FROM equipment_fault WHERE equipment_id IN (${h})`, equipmentIds);
  add("equipment_photo", `DELETE FROM equipment_photo WHERE equipment_id IN (${h})`, equipmentIds);
  add("equipment_photos", `DELETE FROM equipment_photos WHERE equipment_id IN (${h})`, equipmentIds);
}
if (businessIds.length) {
  const h = holes(businessIds.length);
  add("equipment", `DELETE FROM equipment WHERE business_id IN (${h})`, businessIds);
  add("provider_coverage", `DELETE FROM provider_coverage WHERE business_id IN (${h})`, businessIds);
  add("business_document", `DELETE FROM business_document WHERE business_id IN (${h})`, businessIds);
  add("payout_destination", `DELETE FROM payout_destination WHERE business_id IN (${h})`, businessIds);
  add("monime_phone_verification", `DELETE FROM monime_phone_verification WHERE business_id IN (${h})`, businessIds);
  add("payout_request", `DELETE FROM payout_request WHERE business_id IN (${h})`, businessIds);
  add("team_member", `DELETE FROM team_member WHERE business_id IN (${h})`, businessIds);
  add("provider_business", `DELETE FROM provider_business WHERE id IN (${h})`, businessIds);
}

const uh = holes(userIds.length);
const eh = holes(emails.length);
// In case one of these accounts was ever invited onto somebody else's business.
add("team_member", `DELETE FROM team_member WHERE user_id IN (${uh})`, userIds);
add("notification_read", `DELETE FROM notification_read WHERE user_id IN (${uh})`, userIds);
add("notification_outbox", `DELETE FROM notification_outbox WHERE recipient IN (${eh})`, emails);
add("staff_invite", `DELETE FROM staff_invite WHERE email IN (${eh})`, emails);
add("audit_log", `DELETE FROM audit_log WHERE actor_id IN (${uh})`, userIds);
// A follow-up keeps its item and its due date; it only loses an owner who no longer exists.
add("follow_up", `UPDATE follow_up SET owner_id = NULL WHERE owner_id IN (${uh})`, userIds);
// staff_mfa hangs off a session, so it goes before the sessions do.
add("staff_mfa", `DELETE FROM staff_mfa WHERE session_id IN (SELECT id FROM session WHERE "userId" IN (${uh}))`, userIds);
add("session", `DELETE FROM session WHERE "userId" IN (${uh})`, userIds);
add("account", `DELETE FROM account WHERE "userId" IN (${uh})`, userIds);
// Better Auth keys these by what is being verified, not by the account it belongs to.
add("verification", `DELETE FROM verification WHERE identifier IN (${eh})`, emails);
add("user", `DELETE FROM "user" WHERE id IN (${uh})`, userIds);

if (!confirmed) {
  console.log(
    `\nThis would delete ${users.length} account(s), ${businesses.length} business(es) and ` +
      `${equipment.length} machine(s), along with their sessions, logins, team rows, ` +
      "notifications and audit entries.",
  );
  console.log("\nNothing has been deleted. Run again with --yes to do it:");
  console.log("  npm run db:delete-demo -- --yes");
  process.exit(0);
}

/* ----------------------------------------------------------------- do it */

// One transaction: an account half-deleted is worse than one not deleted at all.
const removed = await db.tx(async (t) => {
  const counts: { table: string; rows: number }[] = [];
  for (const s of steps) {
    const res = await t.run(s.sql, ...s.args);
    if (res.changes) counts.push({ table: s.table, rows: res.changes });
  }
  return counts;
});

for (const c of removed) console.log(`  ${String(c.rows).padStart(4)}  ${c.table}`);
console.log(
  `\nDeleted ${removed.reduce((n, c) => n + c.rows, 0)} rows. ` +
    "The demo accounts are gone; every other account is untouched.",
);
