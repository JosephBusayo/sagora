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
import * as holds from "../src/lib/holds";
import { operator, provider as providerFixture, quoteInput } from "./fixtures.mjs";
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
// A quote now names an actual operator as well as actual machines, and holds both.
const driver = await operator(biz, "Driver A");
const kit = (over: {
  amountMinor: number; startDate: string; daysToComplete: number;
  assetIds?: string[]; operatorId?: string; includes?: string;
}) => ({
  includes: "Tractor", note: "", dailyRateMinor: 10000,
  assetIds: [tractor.id], operatorId: driver, ...over,
});

console.log("\nDays to complete set the job window");
const f1 = await user("Farmer One");
const r1 = await request(f1, "Farmer One");
const q1 = await quotes.sendQuote(r1.id, biz, owner, kit({ amountMinor: 100000, startDate: inDays(10), daysToComplete: 5 }));
if (!q1.ok) throw new Error(q1.reason);
ok("the quote carries the machines it named", q1.quote.assetIds.length === 1);
ok("five days from the start date ends four days later", quotes.endDateOf(q1.quote) === inDays(14));

const a1 = await quotes.acceptQuote(q1.quote.id, f1);
ok("the farmer can accept it", a1.ok);
const j1 = (await jobs.jobForRequest(r1.id))!;
ok("accepting schedules the job for the quoted window", j1.startDate === inDays(10) && j1.endDate === inDays(14));
ok("accepting commits the machine to it", j1.assetIds.includes(tractor.id));
ok("the job is scheduled, not left unscheduled", j1.status === "scheduled");

// Karim's handover of 23 November reverses what the 22 November call agreed: sending a quote now
// holds the resources, so a second overlapping quote on the same tractor is refused outright
// rather than allowed and then beaten to acceptance. Handover case A05.
console.log("\nSending a quote holds the resources");
const f2 = await user("Farmer Two");
const r2 = await request(f2, "Farmer Two");
// Overlaps the window the first quote holds (11-15 against 10-14).
const q2 = await quotes.sendQuote(r2.id, biz, owner, kit({ amountMinor: 90000, startDate: inDays(11), daysToComplete: 5 }));
ok("the same machine cannot be quoted twice over the same days", !q2.ok);
ok("and the refusal names the machine", !q2.ok && q2.reason.includes("Tractor A"));
ok("the refused quote left nothing behind", (await quotes.listForRequest(r2.id)).length === 0);
ok("nor any stray hold", (await holds.forRequest(r2.id)).length === 0);

const f3 = await user("Farmer Three");
const r3 = await request(f3, "Farmer Three");
// The day after the first window ends is no longer free: since migration 028 a hold covers the
// work plus a day's travel each side, so the first quote (10-14) blocks 9-15 and the machine is
// not available again until the 16th. The old test asked for the 15th and passing it would have
// meant the travel allowance was doing nothing.
const stillTravelling = await quotes.sendQuote(r3.id, biz, owner, kit({ amountMinor: 80000, startDate: inDays(15), daysToComplete: 2 }));
ok("the day the machine travels is not offered as free", !stillTravelling.ok);
ok("and the refusal offers the first date that would work",
  !stillTravelling.ok && stillTravelling.reason.includes("The earliest everything is free is"));
const q3 = await quotes.sendQuote(r3.id, biz, owner, kit({ amountMinor: 80000, startDate: inDays(17), daysToComplete: 2 }));
ok("the same machine can be quoted once the travel is clear", q3.ok);
if (!q3.ok) throw new Error(q3.reason);
ok("and that farmer can accept", (await quotes.acceptQuote(q3.quote.id, f3)).ok);

console.log("\nThe operator is held too, and the whole set moves together");
const f6 = await user("Farmer Six");
const r6 = await request(f6, "Farmer Six");
const spare = await equipment.addAsset(biz, owner, {
  name: "Tractor B", kind: "machine", identifier: "REG-2", ownership: "owned", notes: "",
});
// A different machine, but the same driver, over days the first quote already holds.
const q6 = await quotes.sendQuote(r6.id, biz, owner, kit({
  amountMinor: 60000, startDate: inDays(11), daysToComplete: 2, assetIds: [spare.id],
}));
ok("one operator cannot be on two quotes at once", !q6.ok);
ok("and the refusal names the operator", !q6.ok && q6.reason.includes("Driver A"));
ok("the free machine was not left half-held",
  (await holds.clashesFor([{ kind: "equipment", resourceId: spare.id, label: "" }],
    { from: inDays(11), to: inDays(12) }, null, biz)).length === 0);

console.log("\nA quote cannot be sent without actual resources");
const f7 = await user("Farmer Seven");
const r7 = await request(f7, "Farmer Seven");
const noKit = await quotes.sendQuote(r7.id, biz, owner, {
  amountMinor: 50000, includes: "Tractor", startDate: inDays(30), note: "",
  daysToComplete: 1, dailyRateMinor: 50000, assetIds: [], operatorId: driver,
});
ok("no equipment is refused", !noKit.ok && noKit.reason.includes("equipment"));
const noDriver = await quotes.sendQuote(r7.id, biz, owner, {
  amountMinor: 50000, includes: "Tractor", startDate: inDays(30), note: "",
  daysToComplete: 1, dailyRateMinor: 50000, assetIds: [tractor.id], operatorId: "",
});
ok("no operator is refused", !noDriver.ok && noDriver.reason.includes("operator"));

console.log("\nExpiry never runs past the proposed start");
ok("a start far off gets the full 48 hours",
  quotes.expiryFor("2026-11-23T08:00:00.000Z", "2026-12-01") === "2026-11-25T08:00:00.000Z");
ok("a start sooner than that caps the window",
  quotes.expiryFor("2026-11-23T08:00:00.000Z", "2026-11-24") === "2026-11-24T00:00:00.000Z");
const f8 = await user("Farmer Eight");
const r8 = await request(f8, "Farmer Eight");
const tooSoon = await quotes.sendQuote(r8.id, biz, owner, kit({ amountMinor: 50000, startDate: inDays(0), daysToComplete: 1 }));
ok("work starting today cannot be quoted at all", !tooSoon.ok);

console.log("\nChoosing one quote frees what the others held");
const f9 = await user("Farmer Nine");
const r9 = await request(f9, "Farmer Nine");
const rival = await providerFixture("Rival");
const mine = await quotes.sendQuote(r9.id, biz, owner, kit({ amountMinor: 70000, startDate: inDays(60), daysToComplete: 2 }));
const theirs = await quotes.sendQuote(r9.id, rival.biz, rival.owner, quoteInput(rival, inDays(60)));
if (!mine.ok || !theirs.ok) throw new Error("two-provider fixture failed");
ok("both providers hold their own resources", (await holds.forRequest(r9.id)).length === 4);
ok("the farmer accepts one", (await quotes.acceptQuote(mine.quote.id, f9)).ok);
ok("the loser's holds are released", (await holds.forQuote(theirs.quote.id)).every((h) => h.status === "released"));
ok("the winner's holds are converted, not released", (await holds.forQuote(mine.quote.id)).every((h) => h.status === "converted"));

console.log("\nA quote lapses after 48 hours");
const f4 = await user("Farmer Four");
const r4 = await request(f4, "Farmer Four");
const q4 = await quotes.sendQuote(r4.id, biz, owner, kit({ amountMinor: 70000, startDate: inDays(40), daysToComplete: 1 }));
if (!q4.ok) throw new Error(q4.reason);
ok("a fresh quote has not expired", !quotes.isExpired(q4.quote));
// Age it past the window.
// The stored instant is what everything reads now, so ageing a quote has to move it too.
const old = new Date(Date.now() - 49 * 3600_000).toISOString();
await db.run("UPDATE quote SET created_at=?, expires_at=? WHERE id=?",
  old, new Date(Date.now() - 3600_000).toISOString(), q4.quote.id);
await db.run("UPDATE resource_hold SET expires_at=? WHERE quote_id=?",
  new Date(Date.now() - 3600_000).toISOString(), q4.quote.id);
const aged = (await quotes.getQuote(q4.quote.id))!;
ok("a quote older than 48 hours has expired", quotes.isExpired(aged));
const a4 = await quotes.acceptQuote(aged.id, f4);
ok("an expired quote cannot be accepted", !a4.ok);
ok("and says why", !a4.ok && a4.reason.includes("48 hours"));
ok("the sweep releases what it was holding", (await holds.sweepExpired()).holds > 0);
ok("and the machine is free again",
  (await holds.clashesFor([{ kind: "equipment", resourceId: tractor.id, label: "" }],
    { from: inDays(40), to: inDays(40) }, null, biz)).length === 0);
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
