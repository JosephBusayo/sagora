/**
 * The super admin's edit and delete rules, checked without a browser. Run against a throwaway
 * database:
 *   DATABASE_PATH=../tmp/a.db npm run db:migrate && DATABASE_PATH=../tmp/a.db npm run check:admin
 *
 * These decide whether a record is destroyed, so they get a test that does not depend on any
 * screen: a record with work or money behind it is refused and the blockers named, a clean one
 * really goes, and an email address is never changed by an edit.
 */
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";
import { randomUUID } from "node:crypto";
const { db } = await import("../src/lib/db");
const { createRequest } = await import("../src/lib/requests");
const { sendQuote } = await import("../src/lib/quotes");
const admin = await import("../src/lib/admin");
const { machine, operator } = await import("./fixtures.mjs");

const fails: string[] = [];
let n = 0;
const ok = (what: string, cond: boolean) => {
  n++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${what}`);
  if (!cond) fails.push(what);
};

const now = new Date().toISOString();
async function user(name: string, role = "farmer") {
  const id = randomUUID();
  await db.run(`INSERT INTO "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt") VALUES (?,?,?,?,?,?,?)`,
    id, name, `${id}@example.test`, true, role, now, now);
  return id;
}
async function business(ownerId: string, name: string) {
  const id = randomUUID();
  await db.run(`INSERT INTO provider_business (id, user_id, name, phone, email, district, town, operating_districts, services, status, created_at, updated_at)
     VALUES (?,?,?,'76000000',?,'Bo','Testville','["Bo"]','["ploughing"]','approved',?,?)`, id, ownerId, name, `${id}@example.test`, now, now);
  return id;
}
const req = (farmer: string, label: string) => createRequest(farmer, {
  service: "ploughing", acres: 3, landAccess: "easy", landCondition: "", landClearance: "cleared",
  district: "Bo", village: "Testville", preferredDate: "2027-03-01", alternateDate: null, notes: "",
  contactName: label, contactPhone: "76000001", contactEmail: `${farmer}@example.test`,
});

const boss = await user("The Admin", "admin");

console.log("\nA clean request can be deleted");
const f1 = await user("Farmer One");
const r1 = await req(f1, "Farmer One");
ok("nothing blocks it", (await admin.requestBlockers(r1.id)).length === 0);
const d1 = await admin.deleteRequest(boss, r1.id);
ok("it deletes", d1.ok);
ok("and is really gone", !(await db.get("SELECT id FROM service_request WHERE id=?", r1.id)));

console.log("\nA request with a quote is refused");
const owner = await user("Owner", "provider");
const biz = await business(owner, "Testing Tractors");
const f2 = await user("Farmer Two");
const r2 = await req(f2, "Farmer Two");
// A quote holds actual resources now, so the business needs them before it can send one.
const mach = await machine(biz, "Admin tractor");
const driver = await operator(biz, "Admin driver");
const q = await sendQuote(r2.id, biz, owner, {
  amountMinor: 50000, includes: "Tractor", startDate: "2027-03-01", note: "", daysToComplete: 1,
  dailyRateMinor: 50000, assetIds: [mach], operatorId: driver,
});
ok("the quote was sent", q.ok);
const d2 = await admin.deleteRequest(boss, r2.id);
ok("the delete is refused", !d2.ok);
ok("and names the quote", !d2.ok && d2.reason.includes("quote"));
ok("the request is still there", Boolean(await db.get("SELECT id FROM service_request WHERE id=?", r2.id)));
const c2 = await admin.cancelRequestAsAdmin(boss, r2.id);
ok("cancelling is offered and works", c2.ok);
ok("and the record survives, cancelled",
  (await db.get<{ status: string }>("SELECT status FROM service_request WHERE id=?", r2.id))?.status === "cancelled");

console.log("\nEditing a request changes what it should and nothing else");
const f3 = await user("Farmer Three");
const r3 = await req(f3, "Farmer Three");
const before = await db.get<{ contact_email: string; reference: string }>(
  "SELECT contact_email, reference FROM service_request WHERE id=?", r3.id);
const u3 = await admin.updateRequest(boss, r3.id, {
  service: "planting", acres: 9, district: "Bombali", chiefdom: "Makari Gbanti", village: "Masuba",
  preferredDate: "2027-04-02", notes: "edited", contactName: "New Name", contactPhone: "76999888",
});
ok("the edit saves", u3.ok);
const after = await db.get<{ service: string; acres: number; district: string; village: string; contact_name: string; contact_email: string; reference: string }>(
  "SELECT service, acres, district, village, contact_name, contact_email, reference FROM service_request WHERE id=?", r3.id);
ok("the service changed", after?.service === "planting");
ok("the land size changed", Number(after?.acres) === 9);
ok("the district changed", after?.district === "Bombali");
ok("the name changed", after?.contact_name === "New Name");
ok("the email was NOT touched", after?.contact_email === before?.contact_email);
ok("the reference was NOT touched", after?.reference === before?.reference);

console.log("\nA provider who has quoted is refused, and can be suspended instead");
const dp = await admin.deleteProvider(boss, biz);
ok("the delete is refused", !dp.ok);
ok("and names the quotes", !dp.ok && dp.reason.includes("quote"));
const sp = await admin.suspendProvider(boss, biz);
ok("suspending works", sp.ok);
ok("and the business survives, rejected",
  (await db.get<{ status: string }>("SELECT status FROM provider_business WHERE id=?", biz))?.status === "rejected");

console.log("\nA provider with nothing behind them can be deleted");
const owner2 = await user("Owner Two", "provider");
const biz2 = await business(owner2, "Never Quoted");
await db.run(`INSERT INTO provider_coverage (business_id, district, service, status, requested_at, decided_at) VALUES (?,?,?,?,?,?)`,
  biz2, "Bo", "ploughing", "active", now, now);
ok("nothing blocks it", (await admin.providerBlockers(biz2)).length === 0);
ok("it deletes", (await admin.deleteProvider(boss, biz2)).ok);
ok("and is really gone", !(await db.get("SELECT id FROM provider_business WHERE id=?", biz2)));
ok("its coverage went with it", !(await db.get("SELECT business_id FROM provider_coverage WHERE business_id=?", biz2)));
ok("but the owner's login is kept", Boolean(await db.get(`SELECT id FROM "user" WHERE id=?`, owner2)));

console.log("\nA farmer with requests is refused, one without is deleted");
const df2 = await admin.deleteFarmer(boss, f2);
ok("the farmer with a request is refused", !df2.ok);
ok("and is told how many", !df2.ok && df2.reason.includes("request"));
ok("a farmer with none deletes", (await admin.deleteFarmer(boss, f1)).ok);
ok("and is really gone", !(await db.get(`SELECT id FROM "user" WHERE id=?`, f1)));

console.log("\nEditing a farmer never changes their login");
const emailBefore = (await db.get<{ email: string }>(`SELECT email FROM "user" WHERE id=?`, f2))?.email;
ok("the edit saves", (await admin.updateFarmer(boss, f2, { name: "Renamed", phone: "76000999" })).ok);
const f2after = await db.get<{ name: string; phone: string; email: string }>(`SELECT name, phone, email FROM "user" WHERE id=?`, f2);
ok("the name changed", f2after?.name === "Renamed");
ok("the phone changed", f2after?.phone === "76000999");
ok("the email was NOT touched", f2after?.email === emailBefore);

console.log("\nEvery change is written to the audit log");
const entries = await db.all<{ action: string }>("SELECT action FROM audit_log WHERE actor_id=?", boss);
const actions = entries.map((e) => e.action);
for (const a of ["admin.request.deleted", "admin.request.cancelled", "admin.request.updated",
  "admin.provider.suspended", "admin.provider.deleted", "admin.farmer.deleted", "admin.farmer.updated"]) {
  ok(`${a} is logged`, actions.includes(a));
}

console.log(`\n${n - fails.length}/${n} checks passed.`);
if (fails.length) process.exit(1);
