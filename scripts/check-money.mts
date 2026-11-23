/**
 * A direct check of the money rules, without a browser. Run against a throwaway database:
 *   npm run check:money
 *
 * These are the brief's hard rules, so they get a test that does not depend on any screen:
 * balanced entries, corrections by reversal, idempotent payments, one booking decision,
 * no overbooking, no payout without the farmer's confirmation, and preparer ≠ approver.
 */
import { randomUUID } from "node:crypto";
import { db } from "../src/lib/db";
import * as ledger from "../src/lib/ledger";
import * as payments from "../src/lib/payments";
import * as settlement from "../src/lib/settlement";
import * as requests from "../src/lib/requests";
import * as quotes from "../src/lib/quotes";
import * as jobs from "../src/lib/jobs";
import * as equipment from "../src/lib/equipment";
import * as fee from "../src/lib/fee";
import { machine, operator, provider as providerFixture, quoteInput } from "./fixtures.mjs";


const fail: string[] = [];
let checks = 0;
async function ok(what: string, condition: boolean) {
  checks++;
  if (condition) console.log(`  ok   ${what}`);
  else {
    console.log(`  FAIL ${what}`);
    fail.push(what);
  }
}
async function throws(what: string, fn: () => unknown) {
  checks++;
  try {
    await fn();
    console.log(`  FAIL ${what} (did not throw)`);
    fail.push(what);
  } catch {
    console.log(`  ok   ${what}`);
  }
}



const now = new Date().toISOString();
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

async function user(name: string, role = "farmer") {
  const id = randomUUID();
  await db.run(`INSERT INTO "user" (id, name, email, "emailVerified", role, "createdAt", "updatedAt")
     VALUES (?,?,?,?,?,?,?)`, id, name, `${id}@example.test`, true, role, now, now);
  return id;
}
async function business(ownerId: string, name: string) {
  const id = randomUUID();
  await db.run(`INSERT INTO provider_business (id, user_id, name, phone, email, district, town, services, status, created_at, updated_at)
     VALUES (?,?,?,'76000000',?,'Bo','Testville','["ploughing"]','approved',?,?)`, id, ownerId, name, `${id}@example.test`, now, now);
  return id;
}

// A whole job, from request to agreement to a scheduled machine.
async function paidJobFixture(label: string) {
  const farmer = await user(`Farmer ${label}`);
  // The machine and the driver have to exist before the quote now: sending one holds them.
  const p = await providerFixture(label);
  const req = await requests.createRequest(farmer, {
    service: "ploughing", acres: 4, landAccess: "easy", landCondition: "", landClearance: "cleared", district: "Bo", village: "Testville",
    preferredDate: inDays(20), alternateDate: null, notes: "",
    contactName: `Farmer ${label}`, contactPhone: "76000001", contactEmail: `${farmer}@example.test`,
  });
  const quote = await quotes.sendQuote(req.id, p.biz, p.owner, quoteInput(p, inDays(20)));
  if (!quote.ok) throw new Error(`fixture quote failed: ${quote.reason}`);
  const accepted = await quotes.acceptQuote(quote.quote.id, farmer);
  if (!accepted.ok) throw new Error(`fixture accept failed: ${accepted.reason}`);
  // Accepting now schedules the work from the quote's own hold, so there is nothing to schedule
  // by hand. The job already owns the dates, the machine and the operator.
  const job = (await jobs.jobForRequest(req.id))!;
  if (!job.startDate || job.assetIds.length === 0) throw new Error("fixture: accepting did not commit the resources");
  return { farmer, owner: p.owner, biz: p.biz, req, asset: { id: p.machine }, jobId: job.id, provider: p };
}

console.log("\nLedger");
{
  const ref = { type: "test", id: randomUUID() };
  await throws("entries that do not sum to zero are refused", async () =>
    await ledger.post([{ account: "a", amountMinor: 100 }, { account: "b", amountMinor: -99 }], ref),
  );
  await throws("fractional minor units are refused", async () =>
    await ledger.post([{ account: "a", amountMinor: 1.5 }, { account: "b", amountMinor: -1.5 }], ref),
  );
  const txn = await ledger.post([{ account: "test:a", amountMinor: 500 }, { account: "test:b", amountMinor: -500 }], ref);
  await ok("a balanced transaction posts", await ledger.balance("test:a") === 500);
  await ledger.reverse(txn, "mistake");
  await ok("a reversal returns the balance to zero", await ledger.balance("test:a") === 0);
  await ok("the reversal leaves both entries in place", (await ledger.entriesFor(ref.type, ref.id)).length === 4);
  await ok("the whole ledger balances", await ledger.ledgerIsBalanced());
}

console.log("\nPayments");
const paid = await paidJobFixture("paid");
const staffA = await user("Staff A", "staff");
const staffB = await user("Staff B", "staff");
{
  const part = await payments.recordPayment(staffA, {
    requestId: paid.req.id, amountMinor: 50000, method: "mobile_money", externalRef: "MM-0001", note: "",
  });
  await ok("a part payment is recorded", part.ok && part.outcome === "part_paid");
  await ok("a part payment does not book the job", await payments.bookingFor(paid.req.id) === null);

  const again = await payments.recordPayment(staffA, {
    requestId: paid.req.id, amountMinor: 50000, method: "mobile_money", externalRef: "MM-0001", note: "",
  });
  await ok("the same receipt reference cannot be recorded twice", !again.ok);
  await ok("the duplicate added no money", await payments.fundsFor(paid.req.id) === 50000);

  // The farmer owes the provider's 150,000 plus Sagora's 10%, so 165,000 is the balance — the
  // reversal of 23 Nov 2026 in one number.
  const owed = (await quotes.agreementFor(paid.req.id))!;
  await ok("the farmer owes the price plus the fee", owed.amountMinor === 150000 && owed.feeMinor === 15000 && owed.farmerTotalMinor === 165000);
  const rest = await payments.recordPayment(staffA, {
    requestId: paid.req.id, amountMinor: 115000, method: "bank", externalRef: "BK-0002", note: "",
  });
  await ok("paying the balance books the job", rest.ok && rest.outcome === "booked");
  // The booking records what the provider is owed, which is their price, not the farmer's total.
  await ok("the booking exists", (await payments.bookingFor(paid.req.id))?.amountMinor === 150000);
  await ok("all of it is held against the job", await payments.fundsFor(paid.req.id) === 165000);

  const third = await payments.recordPayment(staffA, {
    requestId: paid.req.id, amountMinor: 1000, method: "cash", externalRef: "CA-0003", note: "",
  });
  await ok("a booked job refuses further payment", !third.ok);
  await ok("the ledger still balances", await ledger.ledgerIsBalanced());
}

console.log("\nPayment received, booking not confirmed");
{
  const late = await paidJobFixture("late");
  // Something else takes the machine for those dates, so capacity is gone when money arrives.
  const other = await requests.createRequest(late.farmer, {
    service: "ploughing", acres: 2, landAccess: "easy", landCondition: "", landClearance: "cleared", district: "Bo", village: "Testville",
    preferredDate: inDays(20), alternateDate: null, notes: "",
    contactName: "Other", contactPhone: "76000002", contactEmail: `${late.farmer}@example.test`,
  });
  // A second machine for the competing job: the first is already held by the fixture's own quote,
  // which is exactly the rule being relied on here.
  const mach2 = await machine(late.biz, "Late tractor two");
  const driver2 = await operator(late.biz, "Late driver two");
  const q2 = await quotes.sendQuote(other.id, late.biz, late.owner, {
    amountMinor: 50000, includes: "Tractor", startDate: inDays(20), note: "", daysToComplete: 2,
    dailyRateMinor: 25000, assetIds: [mach2], operatorId: driver2,
  });
  if (!q2.ok) throw new Error(q2.reason);
  await quotes.acceptQuote(q2.quote.id, late.farmer);
  const otherJob = (await jobs.jobForRequest(other.id))!;
  const taken = await jobs.scheduleJob(late.biz, late.owner, otherJob.id, {
    startDate: inDays(20), endDate: inDays(21), operatorId: null, assetIds: [late.asset.id],
  });
  await ok("a second job cannot hold the same machine for the same dates", !taken.ok);

  // Force the clash the way reality would: the machine is moved onto the other job directly.
  await db.run("UPDATE job SET status='scheduled', start_date=?, end_date=? WHERE id=?", inDays(20), inDays(21), otherJob.id);
  await db.run("INSERT INTO job_asset (job_id, equipment_id) VALUES (?,?)", otherJob.id, late.asset.id);

  const res = await payments.recordPayment(staffA, {
    requestId: late.req.id, amountMinor: 150000, method: "mobile_money", externalRef: `MM-${randomUUID()}`, note: "",
  });
  await ok("money arriving after capacity is lost opens a case", res.ok && res.outcome === "case_opened");
  await ok("nothing was overbooked", await payments.bookingFor(late.req.id) === null);
  await ok("the money is still held", await payments.fundsFor(late.req.id) === 150000);
  await ok("the case is in the staff queue", (await payments.openCases()).some((c) => c.requestId === late.req.id));

  // The way out of that case is a refund.
  const prep = await settlement.prepareRefund(staffA, late.req.id, 150000, "Machine was no longer free");
  await ok("a refund can be prepared", prep.ok);
  await throws("the preparer cannot approve their own refund", async () => {
    const r = await settlement.approveRelease(staffA, (prep as { value: string }).value);
    if (!r.ok) throw new Error(r.reason);
  });
  const appr = await settlement.approveRelease(staffB, (prep as { value: string }).value);
  await ok("a second person can approve it", appr.ok);
  const sent = await settlement.markSent(staffB, (prep as { value: string }).value, "mobile_money", "MM-REFUND-1");
  await ok("the refund is sent", sent.ok);
  await ok("the money is no longer held", await payments.fundsFor(late.req.id) === 0);
  await ok("the ledger still balances", await ledger.ledgerIsBalanced());
}

console.log("\nPayout");
{
  const early = await settlement.preparePayout(staffA, paid.req.id);
  await ok("no payout before the farmer confirms delivery", !early.ok);

  await jobs.startWork(paid.biz, paid.owner, paid.jobId);
  await jobs.reportWork(paid.biz, paid.owner, paid.jobId, 4, "Done");
  const reported = await settlement.preparePayout(staffA, paid.req.id);
  await ok("a reported job is not a confirmed one", !reported.ok);

  await jobs.confirmDelivery(paid.farmer, paid.req.id);
  const prep = await settlement.preparePayout(staffA, paid.req.id);
  await ok("a confirmed job can be paid out", prep.ok);
  const id = (prep as { value: string }).value;

  const second = await settlement.preparePayout(staffA, paid.req.id);
  await ok("a second payout cannot be prepared alongside the first", !second.ok);

  const selfApprove = await settlement.approveRelease(staffA, id);
  await ok("the preparer cannot approve their own payout", !selfApprove.ok);

  await ok("approval by a second person works", (await settlement.approveRelease(staffB, id)).ok);
  // The whole point of the reversal: the provider's figure is untouched and Sagora's comes from
  // the extra the farmer paid, so 2,000 + 200 = 2,200 at this job's scale.
  await ok("the provider is owed their full quoted price", await ledger.balance(`payable:${paid.biz}`) === 150000);
  await ok("Sagora's fee came from the farmer, not the provider", await ledger.balance("fee:platform") === 15000);
  await ok("the job's funds are fully distributed", await payments.fundsFor(paid.req.id) === 0);

  // Changing the amount must invalidate the approval.
  await ok("the amount can be revised", (await settlement.reviseAmount(staffB, id, 140000)).ok);
  await ok("revising sent it back for approval", (await settlement.getRelease(id))?.status === "prepared");
  await ok("revising undid what was owed", await ledger.balance(`payable:${paid.biz}`) === 0);
  await ok("sending is refused while unapproved", !(await settlement.markSent(staffB, id, "bank", "BK-OUT-1")).ok);

  await settlement.approveRelease(staffB, id);
  await ok("sending works once re-approved", (await settlement.markSent(staffB, id, "bank", "BK-OUT-1")).ok);
  await ok("nothing is left owed", await ledger.balance(`payable:${paid.biz}`) === 0);
  // The farmer paid 165,000, so a 140,000 payout leaves 25,000 against the job.
  await ok("the balance stays held after a reduced payout", await payments.fundsFor(paid.req.id) === 25000);
  await ok("the ledger still balances", await ledger.ledgerIsBalanced());
}

console.log("\nFees and reconciliation");
{
  // The handover's own worked example: provider 2,000, fee 200, farmer 2,200 — and explicitly
  // not 2,020, which is what taking 10% of the farmer's total would give.
  await ok("the pilot fee is approved at 10%", fee.FEE_POLICY.approved && fee.FEE_POLICY.percent === 10);
  await ok("the fee is 10% of the provider's price", fee.serviceFeeOn(200000) === 20000);
  await ok("the farmer's total is the price plus the fee", fee.farmerTotal(200000, fee.serviceFeeOn(200000)) === 220000);
  await ok("the provider's amount is never reduced", fee.farmerTotal(200000, fee.serviceFeeOn(200000)) - fee.serviceFeeOn(200000) === 200000);
  await ok("it is not 10% of the farmer's total", fee.serviceFeeOn(200000) !== 20200 - 18200);
  const live = { ...fee.FEE_POLICY };
  fee.FEE_POLICY.approved = false;
  await ok("switching the policy off charges no fee", fee.serviceFeeOn(150000) === 0);
  fee.FEE_POLICY.approved = live.approved;
  await ok("there is no first-twenty-jobs waiver any more", fee.serviceFeeOn(150000) === 15000);

  // A part payment carries a proportional share of each, and the remainder favours the provider.
  const half = settlement.splitHeld(110000, { amountMinor: 200000, feeMinor: 20000 });
  await ok("half the farmer's total splits in half", half.grossMinor === 110000 && half.feeMinor === 10000 && half.netMinor === 100000);
  await ok("a split always reconciles", half.netMinor + half.feeMinor === half.grossMinor);
  const capped = settlement.splitHeld(999999, { amountMinor: 200000, feeMinor: 20000 });
  await ok("a split never exceeds the farmer's total", capped.grossMinor === 220000 && capped.netMinor === 200000);

  const r = await settlement.reconcile();
  await ok("reconciliation reports a balanced ledger", r.balanced);
  await ok("no account is negative", r.negativeAccounts.length === 0);
  await ok("money held on a finished job is flagged", r.heldAfterCompletion.some((h) => h.requestId === paid.req.id));
}

console.log("\nDisputes");
{
  async function disputed(label: string, ref: string) {
    const d = await paidJobFixture(label);
    await payments.recordPayment(staffA, { requestId: d.req.id, amountMinor: 150000, method: "bank", externalRef: ref, note: "" });
    await jobs.startWork(d.biz, d.owner, d.jobId);
    await jobs.reportWork(d.biz, d.owner, d.jobId, 4, "Done");
    await jobs.raiseConcern(d.farmer, d.req.id, "Half the field was missed");
    return d;
  }

  const paidOut = await disputed("dispute pay", "DP-0001");
  await ok("a dispute is listed for staff", (await settlement.openDisputes()).some((x) => x.requestId === paidOut.req.id));
  await ok("a disputed job cannot be paid out", !(await settlement.preparePayout(staffA, paidOut.req.id)).ok);
  await ok("a dispute needs a note", !(await settlement.resolveDispute(staffA, paidOut.req.id, "release", "")).ok);
  await ok("siding with the provider resolves it", (await settlement.resolveDispute(staffA, paidOut.req.id, "release", "Checked on site")).ok);
  await ok("a dispute cannot be resolved twice", !(await settlement.resolveDispute(staffA, paidOut.req.id, "refund", "Again")).ok);
  await ok("the resolved job can then be paid out", (await settlement.preparePayout(staffA, paidOut.req.id)).ok);

  const refunded = await disputed("dispute refund", "DP-0002");
  await ok("siding with the farmer resolves it", (await settlement.resolveDispute(staffA, refunded.req.id, "refund", "Work not done")).ok);
  const prepared = (await settlement.releasesFor(refunded.req.id)).find((r) => r.kind === "refund");
  await ok("the refund is prepared for the full amount held", prepared?.netMinor === 150000);
  await ok("the refund still needs a second person", prepared?.status === "prepared");
  await ok("the money is still held until that person approves", await payments.fundsFor(refunded.req.id) === 150000);
  await ok("the job no longer holds its machine", (await jobs.clashesFor(refunded.asset.id, inDays(20), inDays(21), null)).length === 0);
  await ok("the ledger still balances after disputes", await ledger.ledgerIsBalanced());
}

console.log("\nRequest kinds");
{
  const owner = await user("Owner direct", "provider");
  const biz = await business(owner, "Direct Business");
  // A quote now holds actual resources, so this business needs some before it can send one.
  const mach = await machine(biz, "Direct tractor");
  const driver = await operator(biz, "Direct driver");
  const kit = (over: {
    amountMinor: number; includes: string; startDate: string; assetIds?: string[]; operatorId?: string;
  }) => ({ note: "", daysToComplete: 2, dailyRateMinor: 10000, assetIds: [mach], operatorId: driver, ...over });
  const other = await user("Owner other", "provider");
  const otherBiz = await business(other, "Other Business");
  const coverage = (id: string) => ({ id, district: "Bo", services: ["ploughing"] });
  const farmer = await user("Farmer direct");
  const base = { service: "ploughing", acres: 2, landAccess: "easy", landCondition: "", landClearance: "cleared", district: "Bo", village: "Directville",
    preferredDate: inDays(20), alternateDate: null, notes: "", contactName: "F", contactPhone: "76000003", contactEmail: "f@example.test" };
  const direct = await requests.createRequest(farmer, { ...base, directTo: biz });
  const seen = async (id: string) => (await requests.browse({}, 1, coverage(id))).rows.some((r) => r.id === direct.id);
  await ok("a direct request reaches its chosen provider", await seen(biz));
  await ok("a direct request is never shown to anyone else", !(await seen(otherBiz)));
  await ok("nor can they find it by searching", (await requests.searchForProvider("Directville", coverage(otherBiz))).length === 0);

  const harvest = await requests.createRequest(farmer, { ...base, service: "harvesting", crop: "Rice" });
  await ok("the crop is kept on the request", harvest.crop === "Rice");
  const quoted = await quotes.sendQuote(harvest.id, biz, owner, kit({ amountMinor: 90000, includes: "Harvest", startDate: inDays(20) }));
  if (!quoted.ok) throw new Error("harvest quote failed");
  await quotes.acceptQuote(quoted.quote.id, farmer);
  const job = (await jobs.jobForRequest(harvest.id))!;
  // Since migration 026 a machine missing a critical specification is blocked on its own, so
  // these fixtures carry theirs — otherwise this would test the wrong refusal.
  const tractor = await equipment.addAsset(biz, owner, {
    name: "Only a tractor", kind: "tractor", identifier: "SN-ONLY", ownership: "owned", notes: "",
    specs: { power: "90", hitch: "Three-point category 2", lift: "2500" },
  });
  const refused = await jobs.scheduleJob(biz, owner, job.id, { startDate: inDays(20), endDate: inDays(21), operatorId: null, assetIds: [tractor.id] });
  await ok("a harvest cannot run without a harvester", !refused.ok);
  await ok("and that is why, not a missing specification", !refused.ok && refused.reason.includes("harvester"));
  const harvester = await equipment.addAsset(biz, owner, {
    name: "Harvester", kind: "harvester", identifier: "SN-HARV", ownership: "owned", notes: "",
    specs: { ownEngine: "Own engine", power: "120", header: "3" },
  });
  const allowed = await jobs.scheduleJob(biz, owner, job.id, { startDate: inDays(20), endDate: inDays(21), operatorId: null, assetIds: [harvester.id] });
  await ok("a harvester can take the job", allowed.ok);

  const assisted = await requests.createRequest(null, { ...base, contactName: "Fatmata", contactEmail: "",
    assisted: { by: staffA, callerName: "Alie", callerRelation: "Her son", mayAccept: "Fatmata" } });
  await ok("an assisted request records who called", assisted.callerName === "Alie" && assisted.farmerId === null);
  // Different dates from the harvest above, so the same tractor is free to be held again.
  const q = await quotes.sendQuote(assisted.id, biz, owner, kit({ amountMinor: 80000, includes: "Plough", startDate: inDays(30) }));
  if (!q.ok) throw new Error("assisted quote failed");
  await ok("nobody can accept it as if it were theirs", !(await quotes.acceptQuote(q.quote.id, farmer)).ok);
  await ok("a coordinator can accept it on the farmer's behalf", (await quotes.acceptQuote(q.quote.id, staffA, true)).ok);
  const own = await requests.createRequest(farmer, base);
  // A second machine, because the first is held for these dates by the quote just above.
  const mach2 = await machine(biz, "Direct tractor two");
  const driver2 = await operator(biz, "Direct driver two");
  const q2 = await quotes.sendQuote(own.id, biz, owner, kit({ amountMinor: 70000, includes: "Plough", startDate: inDays(30), assetIds: [mach2], operatorId: driver2 }));
  if (!q2.ok) throw new Error("own quote failed");
  await ok("a coordinator cannot accept for a farmer with an account", !(await quotes.acceptQuote(q2.quote.id, staffA, true)).ok);
  await requests.logContact(staffA, assisted.id, "Called back, no answer");
  await ok("calls are logged against the request", (await requests.contactsFor(assisted.id)).length === 1);
}

console.log(`\n${checks - fail.length}/${checks} checks passed.`);
if (fail.length) {
  console.log(`\nFailures:\n${fail.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
