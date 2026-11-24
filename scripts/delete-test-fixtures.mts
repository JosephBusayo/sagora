// Removes rule-suite fixture data that was written to a real database by mistake.
// Run: npm run db:delete-fixtures            (shows what it would delete, deletes nothing)
//      npm run db:delete-fixtures -- --yes   (deletes it)
//
// WHY THIS EXISTS. On 24 November 2026 the check:* suites were run with DATABASE_URL uncommented
// in .env.local. DATABASE_PATH is ignored whenever a URL is set (see src/lib/db.ts), so suites
// that were meant to build throwaway SQLite files wrote their fixtures — approved provider
// businesses, equipment, farmers, requests, quotes, holds — straight into the hosted database.
// This is the tidy-up. The real fix is the one-line guard in scripts/fixtures.mts.
//
// WHAT IT TARGETS, AND WHY THAT IS SAFE. Every account scripts/fixtures.mts creates is given an
// email at `@example.test`, which is a reserved domain that cannot receive mail and which no real
// farmer or provider will ever have. That domain is the only thing this script matches on. It does
// not match on names: "Business Register" is a plausible name for a real business and guessing from
// names is how a cleanup script deletes somebody's livelihood.
//
// WHAT IT REFUSES. Any payment, ledger entry or release touching the rows it would remove stops it
// dead. The suites assert the ledger is never involved, so there should be none — and if there is
// one, something other than a fixture is caught in the net and a human needs to look before
// anything is deleted.
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";

const { preferDirectConnection } = await import("./direct-connection.mjs");
preferDirectConnection();

const { db, describe } = await import("../src/lib/db");

/** The domain scripts/fixtures.mts gives every account it makes. Reserved by RFC 2606. */
const FIXTURE_DOMAIN = "%@example.test";

const confirmed = process.argv.includes("--yes");
console.log(`Database: ${describe()}\n`);

const holes = (n: number) => Array.from({ length: n }, () => "?").join(",");

/* ------------------------------------------------------------------ find it */

const users = await db.all<{ id: string; email: string; name: string; role: string }>(
  `SELECT id, email, name, role FROM "user" WHERE email LIKE ? ORDER BY email`, FIXTURE_DOMAIN);

const businesses = await db.all<{ id: string; name: string; status: string; email: string }>(
  `SELECT id, name, status, email FROM provider_business WHERE email LIKE ? ORDER BY name`, FIXTURE_DOMAIN);

if (users.length === 0 && businesses.length === 0) {
  console.log("No fixture accounts in this database. Nothing to do.");
  process.exit(0);
}

const userIds = users.map((u) => u.id);
const emails = users.map((u) => u.email);
// A fixture business is owned by a fixture user, but match on its own email too: a half-finished
// suite run can leave a business whose owner never got written.
const businessIds = [...new Set(businesses.map((b) => b.id))];

console.log(`${users.length} account(s):`);
for (const u of users) console.log(`  ${u.email}  (${u.name}, ${u.role})`);
console.log(`\n${businesses.length} business(es):`);
for (const b of businesses) console.log(`  "${b.name}"  (${b.status})`);

const equipment = businessIds.length
  ? await db.all<{ id: string; name: string; identifier: string }>(
      `SELECT id, name, identifier FROM equipment WHERE business_id IN (${holes(businessIds.length)}) ORDER BY name`,
      ...businessIds)
  : [];
const equipmentIds = equipment.map((e) => e.id);
console.log(`\n${equipment.length} machine(s):`);
for (const e of equipment) console.log(`  "${e.name}"  ${e.identifier}`);

// Requests a fixture account owns: as the farmer, as a private job's business, or as a direct
// request's chosen provider. Plus the guest-style ones, which carry the contact email instead.
const reqWhere: string[] = [];
const reqArgs: string[] = [];
if (userIds.length) {
  reqWhere.push(`farmer_id IN (${holes(userIds.length)})`);
  reqArgs.push(...userIds);
}
if (businessIds.length) {
  reqWhere.push(`private_to IN (${holes(businessIds.length)})`, `direct_to IN (${holes(businessIds.length)})`);
  reqArgs.push(...businessIds, ...businessIds);
}
reqWhere.push("contact_email LIKE ?");
reqArgs.push(FIXTURE_DOMAIN);

const requests = await db.all<{ id: string; reference: string; service: string; status: string }>(
  `SELECT id, reference, service, status FROM service_request WHERE ${reqWhere.join(" OR ")} ORDER BY reference`,
  ...reqArgs);
const requestIds = requests.map((r) => r.id);
console.log(`\n${requests.length} request(s):`);
for (const r of requests) console.log(`  ${r.reference}  ${r.service} (${r.status})`);

const jobs = requestIds.length
  ? await db.all<{ id: string }>(`SELECT id FROM job WHERE request_id IN (${holes(requestIds.length)})`, ...requestIds)
  : [];
const jobIds = jobs.map((j) => j.id);

const quotes = requestIds.length || businessIds.length
  ? await db.all<{ id: string }>(
      `SELECT id FROM quote WHERE ${[
        ...(requestIds.length ? [`request_id IN (${holes(requestIds.length)})`] : []),
        ...(businessIds.length ? [`business_id IN (${holes(businessIds.length)})`] : []),
      ].join(" OR ")}`, ...requestIds, ...businessIds)
  : [];
const quoteIds = quotes.map((q) => q.id);
console.log(`\n${jobs.length} job(s), ${quotes.length} quote(s)`);

/* ------------------------------------------- refuse if any money is involved */

// The suites assert the ledger is never touched. If anything here has money against it, then
// something that is not a fixture has been caught and a person has to look first.
const moneyChecks: { what: string; rows: number }[] = [];
if (requestIds.length) {
  const h = holes(requestIds.length);
  for (const [what, sql] of [
    ["payments", `SELECT COUNT(*) AS n FROM payment WHERE request_id IN (${h})`],
    ["ledger entries", `SELECT COUNT(*) AS n FROM ledger_entry WHERE ref_type='request' AND ref_id IN (${h})`],
    ["releases", `SELECT COUNT(*) AS n FROM release WHERE request_id IN (${h})`],
    ["bookings", `SELECT COUNT(*) AS n FROM booking WHERE request_id IN (${h})`],
  ] as const) {
    const r = await db.get<{ n: number }>(sql, ...requestIds);
    if (Number(r?.n ?? 0) > 0) moneyChecks.push({ what, rows: Number(r!.n) });
  }
}
if (moneyChecks.length) {
  console.error(
    `\nSTOPPED. Money is attached to these rows: ${moneyChecks.map((m) => `${m.rows} ${m.what}`).join(", ")}.\n\n` +
      "The rule suites never touch the ledger, so this is not fixture data — or not only fixture\n" +
      "data. Look at it by hand before deleting anything. Nothing has been deleted.",
  );
  process.exit(1);
}

/* ------------------------------------------------------------- what will go */

/** Every statement to run, child rows before the rows they point at. */
const steps: { table: string; sql: string; args: string[] }[] = [];
const add = (table: string, sql: string, args: string[]) => steps.push({ table, sql, args });

if (quoteIds.length) {
  const h = holes(quoteIds.length);
  add("resource_hold", `DELETE FROM resource_hold WHERE quote_id IN (${h})`, quoteIds);
  add("quote_operation", `DELETE FROM quote_operation WHERE quote_id IN (${h})`, quoteIds);
  add("quote_asset", `DELETE FROM quote_asset WHERE quote_id IN (${h})`, quoteIds);
}
if (jobIds.length) {
  const h = holes(jobIds.length);
  add("revenue_allocation", `DELETE FROM revenue_allocation WHERE job_id IN (${h})`, jobIds);
  add("booking_flag", `DELETE FROM booking_flag WHERE job_id IN (${h})`, jobIds);
  add("job_asset", `DELETE FROM job_asset WHERE job_id IN (${h})`, jobIds);
}
if (requestIds.length) {
  const h = holes(requestIds.length);
  add("resource_hold", `DELETE FROM resource_hold WHERE request_id IN (${h})`, requestIds);
  add("agreement", `DELETE FROM agreement WHERE request_id IN (${h})`, requestIds);
  add("booking", `DELETE FROM booking WHERE request_id IN (${h})`, requestIds);
  add("exception_case", `DELETE FROM exception_case WHERE request_id IN (${h})`, requestIds);
  add("inspection", `DELETE FROM inspection WHERE request_id IN (${h})`, requestIds);
  add("request_contact", `DELETE FROM request_contact WHERE request_id IN (${h})`, requestIds);
  add("request_operation", `DELETE FROM request_operation WHERE request_id IN (${h})`, requestIds);
  add("voice_intake", `DELETE FROM voice_intake WHERE request_id IN (${h})`, requestIds);
  add("quote", `DELETE FROM quote WHERE request_id IN (${h})`, requestIds);
  add("job", `DELETE FROM job WHERE request_id IN (${h})`, requestIds);
  add("follow_up", `DELETE FROM follow_up WHERE request_id IN (${h})`, requestIds);
  add("service_request", `DELETE FROM service_request WHERE id IN (${h})`, requestIds);
}
if (equipmentIds.length) {
  const h = holes(equipmentIds.length);
  add("resource_hold", `DELETE FROM resource_hold WHERE resource_id IN (${h})`, equipmentIds);
  add("asset_downtime", `DELETE FROM asset_downtime WHERE equipment_id IN (${h})`, equipmentIds);
  add("asset_share", `DELETE FROM asset_share WHERE equipment_id IN (${h})`, equipmentIds);
  add("asset_custody", `DELETE FROM asset_custody WHERE equipment_id IN (${h})`, equipmentIds);
  add("asset_conflict", `DELETE FROM asset_conflict WHERE equipment_a IN (${h}) OR equipment_b IN (${h})`,
    [...equipmentIds, ...equipmentIds]);
  add("asset_pairing", `DELETE FROM asset_pairing WHERE machine_id IN (${h}) OR implement_id IN (${h})`,
    [...equipmentIds, ...equipmentIds]);
  add("booking_flag", `DELETE FROM booking_flag WHERE equipment_id IN (${h})`, equipmentIds);
  add("equipment_fault", `DELETE FROM equipment_fault WHERE equipment_id IN (${h})`, equipmentIds);
  add("equipment_photo", `DELETE FROM equipment_photo WHERE equipment_id IN (${h})`, equipmentIds);
  add("equipment_photos", `DELETE FROM equipment_photos WHERE equipment_id IN (${h})`, equipmentIds);
  add("equipment", `DELETE FROM equipment WHERE id IN (${h})`, equipmentIds);
}
if (businessIds.length) {
  const h = holes(businessIds.length);
  add("asset_downtime", `DELETE FROM asset_downtime WHERE business_id IN (${h})`, businessIds);
  add("asset_share", `DELETE FROM asset_share WHERE business_id IN (${h})`, businessIds);
  add("asset_pairing", `DELETE FROM asset_pairing WHERE business_id IN (${h})`, businessIds);
  add("resource_hold", `DELETE FROM resource_hold WHERE business_id IN (${h})`, businessIds);
  add("provider_coverage", `DELETE FROM provider_coverage WHERE business_id IN (${h})`, businessIds);
  add("business_document", `DELETE FROM business_document WHERE business_id IN (${h})`, businessIds);
  add("payout_destination", `DELETE FROM payout_destination WHERE business_id IN (${h})`, businessIds);
  add("monime_phone_verification", `DELETE FROM monime_phone_verification WHERE business_id IN (${h})`, businessIds);
  add("payout_request", `DELETE FROM payout_request WHERE business_id IN (${h})`, businessIds);
  add("team_member", `DELETE FROM team_member WHERE business_id IN (${h})`, businessIds);
  add("provider_business", `DELETE FROM provider_business WHERE id IN (${h})`, businessIds);
}
if (userIds.length) {
  const uh = holes(userIds.length);
  const eh = holes(emails.length);
  add("team_member", `DELETE FROM team_member WHERE user_id IN (${uh})`, userIds);
  add("notification_read", `DELETE FROM notification_read WHERE user_id IN (${uh})`, userIds);
  add("notification_outbox", `DELETE FROM notification_outbox WHERE recipient LIKE ?`, [FIXTURE_DOMAIN]);
  add("staff_invite", `DELETE FROM staff_invite WHERE email IN (${eh})`, emails);
  add("audit_log", `DELETE FROM audit_log WHERE actor_id IN (${uh})`, userIds);
  add("follow_up", `UPDATE follow_up SET owner_id = NULL WHERE owner_id IN (${uh})`, userIds);
  add("staff_mfa", `DELETE FROM staff_mfa WHERE session_id IN (SELECT id FROM session WHERE "userId" IN (${uh}))`, userIds);
  add("session", `DELETE FROM session WHERE "userId" IN (${uh})`, userIds);
  add("account", `DELETE FROM account WHERE "userId" IN (${uh})`, userIds);
  add("verification", `DELETE FROM verification WHERE identifier IN (${eh})`, emails);
  add("user", `DELETE FROM "user" WHERE id IN (${uh})`, userIds);
}

if (!confirmed) {
  console.log(
    `\nThis would delete ${users.length} account(s), ${businesses.length} business(es), ` +
      `${equipment.length} machine(s), ${requests.length} request(s), ${quotes.length} quote(s) and ` +
      `${jobs.length} job(s), along with their holds, pairings, downtime, coverage and audit entries.`,
  );
  console.log("\nNothing has been deleted. Run again with --yes to do it:");
  console.log("  npm run db:delete-fixtures -- --yes");
  process.exit(0);
}

/* ----------------------------------------------------------------- do it */

// One transaction: half-deleted fixtures are worse than fixtures left alone.
const removed = await db.tx(async (t) => {
  const counts: { table: string; rows: number }[] = [];
  for (const s of steps) {
    const res = await t.run(s.sql, ...s.args);
    if (res.changes) counts.push({ table: s.table, rows: res.changes });
  }
  return counts;
});

const byTable = new Map<string, number>();
for (const c of removed) byTable.set(c.table, (byTable.get(c.table) ?? 0) + c.rows);
for (const [table, rows] of [...byTable].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${String(rows).padStart(4)}  ${table}`);
}
console.log(
  `\nDeleted ${[...byTable.values()].reduce((n, x) => n + x, 0)} rows. ` +
    "Every account with a real email address is untouched.",
);
