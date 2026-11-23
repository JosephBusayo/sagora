/**
 * The quoting and inspection rules agreed with Karim on 22 Nov 2026, checked without a browser.
 * Run against a throwaway database:
 *   DATABASE_PATH=../tmp/check.db npm run db:migrate && DATABASE_PATH=../tmp/check.db npm run check:quotes
 *
 * These are rules that decide who gets a machine and whose money is taken, so they get a test
 * that does not depend on any screen: equipment is free while a quote is open and locked once one
 * is accepted, overlapping days cannot both win, a quote dies after 48 hours, and a farm that
 * needs a visit cannot be priced until the visit is done.
 */
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import * as requests from "../src/lib/requests";
import * as quotes from "../src/lib/quotes";
import * as jobs from "../src/lib/jobs";
import * as equipment from "../src/lib/equipment";
import * as inspections from "../src/lib/inspections";

const fails: string[] = [];
let n = 0;
const ok = (what: string, cond: boolean) => {
  n++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${what}`);
  if (!cond) fails.push(what);
};

const now = new Date().toISOString();
const inDays = (d: number) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

async function user(name: string, role = "farmer") {
  const id = randomUUID();
  await db.run(`INSERT INTO "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt") VALUES (?,?,?,?,?,?,?)`,
    id, name, `${id}@example.test`, true, role, now, now);
  return id;
}
async function business(ownerId: string, name: string) {
  const id = randomUUID();
  await db.run(`INSERT INTO provider_business (id, user_id, name, phone, email, district, town, services, status, created_at, updated_at)
     VALUES (?,?,?,'76000000',?,'Bo','Testville','["ploughing"]','approved',?,?)`, id, ownerId, name, `${id}@example.test`, now, now);
  return id;
}
async function request(farmer: string, label: string) {
  return requests.createRequest(farmer, {
    service: "ploughing", acres: 3, landAccess: "easy", landCondition: "", landClearance: "cleared",
    district: "Bo", village: "Testville", preferredDate: inDays(10), alternateDate: null, notes: "",
    contactName: label, contactPhone: "76000001", contactEmail: `${farmer}@example.test`,
  });
}

const owner = await user("Owner", "provider");
const biz = await business(owner, "Clash Co");
const tractor = await equipment.addAsset(biz, owner, {
  name: "Tractor A", kind: "machine", identifier: "REG-1", ownership: "owned", notes: "",
});

console.log("\nDays to complete set the job window");
const f1 = await user("Farmer One");
const r1 = await request(f1, "Farmer One");
const q1 = await quotes.sendQuote(r1.id, biz, owner, {
  amountMinor: 100000, includes: "Tractor", startDate: inDays(10), note: "", daysToComplete: 5, assetIds: [tractor.id],
});
if (!q1.ok) throw new Error(q1.reason);
ok("the quote carries the machines it named", q1.quote.assetIds.length === 1);
ok("five days from the start date ends four days later", quotes.endDateOf(q1.quote) === inDays(14));

const a1 = await quotes.acceptQuote(q1.quote.id, f1);
ok("the farmer can accept it", a1.ok);
const j1 = (await jobs.jobForRequest(r1.id))!;
ok("accepting schedules the job for the quoted window", j1.startDate === inDays(10) && j1.endDate === inDays(14));
ok("accepting commits the machine to it", j1.assetIds.includes(tractor.id));
ok("the job is scheduled, not left unscheduled", j1.status === "scheduled");

console.log("\nOpen quotes hold nothing; an accepted one locks the machine");
const f2 = await user("Farmer Two");
const r2 = await request(f2, "Farmer Two");
// Overlaps the committed window (11-15 against 10-14).
const q2 = await quotes.sendQuote(r2.id, biz, owner, {
  amountMinor: 90000, includes: "Tractor", startDate: inDays(11), note: "", daysToComplete: 5, assetIds: [tractor.id],
});
ok("the same machine can still be quoted elsewhere", q2.ok);
if (!q2.ok) throw new Error(q2.reason);
ok("the provider is warned the machine is taken for those days", (await quotes.quoteClashes(q2.quote)).length === 1);
const a2 = await quotes.acceptQuote(q2.quote.id, f2);
ok("a second farmer cannot accept it for overlapping days", !a2.ok);
ok("and is told which machine and when", !a2.ok && a2.reason.includes("Tractor A"));

const f3 = await user("Farmer Three");
const r3 = await request(f3, "Farmer Three");
// Starts the day after the first job ends.
const q3 = await quotes.sendQuote(r3.id, biz, owner, {
  amountMinor: 80000, includes: "Tractor", startDate: inDays(15), note: "", daysToComplete: 2, assetIds: [tractor.id],
});
if (!q3.ok) throw new Error(q3.reason);
ok("no clash outside the committed window", (await quotes.quoteClashes(q3.quote)).length === 0);
ok("and that farmer can accept", (await quotes.acceptQuote(q3.quote.id, f3)).ok);

console.log("\nA quote lapses after 48 hours");
const f4 = await user("Farmer Four");
const r4 = await request(f4, "Farmer Four");
const q4 = await quotes.sendQuote(r4.id, biz, owner, {
  amountMinor: 70000, includes: "Tractor", startDate: inDays(40), note: "", daysToComplete: 1, assetIds: [tractor.id],
});
if (!q4.ok) throw new Error(q4.reason);
ok("a fresh quote has not expired", !quotes.isExpired(q4.quote));
// Age it past the window.
const old = new Date(Date.now() - 49 * 3600_000).toISOString();
await db.run("UPDATE quote SET created_at=? WHERE id=?", old, q4.quote.id);
const aged = (await quotes.getQuote(q4.quote.id))!;
ok("a quote older than 48 hours has expired", quotes.isExpired(aged));
const a4 = await quotes.acceptQuote(aged.id, f4);
ok("an expired quote cannot be accepted", !a4.ok);
ok("and says why", !a4.ok && a4.reason.includes("48 hours"));
ok("the sweep tells both sides once", (await quotes.sweepExpiredQuotes()) === 2);
ok("and does not tell them twice", (await quotes.sweepExpiredQuotes()) === 0);

console.log("\nAn inspection stops the price, and the farmer can answer it");
const f5 = await user("Farmer Five");
const r5 = await request(f5, "Farmer Five");
await inspections.saveInspection(r5.id, biz, owner, { status: "required", scheduledFor: "", findings: "", openQuestions: "" });
ok("a required inspection blocks the quote", (await inspections.inspectionBlocksQuote(r5.id, biz)) !== null);
ok("the farmer can put a day forward", await inspections.proposeInspectionTime(r5.id, biz, f5, inDays(3)));
ok("the proposal is waiting on the provider", (await inspections.inspectionFor(r5.id, biz))?.proposedFor === inDays(3));
await inspections.saveInspection(r5.id, biz, owner, { status: "scheduled", scheduledFor: inDays(3), findings: "", openQuestions: "" });
ok("confirming it clears the proposal", (await inspections.inspectionFor(r5.id, biz))?.proposedFor === "");
ok("a booked inspection still blocks the quote", (await inspections.inspectionBlocksQuote(r5.id, biz)) !== null);
await inspections.saveInspection(r5.id, biz, owner, { status: "completed", scheduledFor: inDays(0), findings: "Wet at the south end", openQuestions: "" });
ok("a completed inspection lets the price through", (await inspections.inspectionBlocksQuote(r5.id, biz)) === null);
ok("staff see it only while it is open", (await inspections.openInspections()).every((i) => i.requestId !== r5.id));

console.log(`\n${n - fails.length}/${n} checks passed.`);
if (fails.length) process.exit(1);
