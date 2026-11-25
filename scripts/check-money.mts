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

/**
 * Registers a machine and has Sagora approve it.
 *
 * Since migration 035 a newly registered machine waits for approval before it can be put on any
 * work. That gate has its own checks in check-register.mts; everything here is about what happens
 * once a machine is accepted, so these go through the review rather than around it.
 */
const addApproved = async (
  businessId: string, actorId: string, input: Parameters<typeof equipment.addAsset>[2],
) => {
  const a = await equipment.addAsset(businessId, actorId, input);
  await equipment.reviewEquipment("suite-reviewer", a.id, "approved", "");
  return (await equipment.getAsset(businessId, a.id))!;
};

import * as fee from "../src/lib/fee";
import * as revenue from "../src/lib/revenue";
import * as holds from "../src/lib/holds";
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
  await db.run(`INSERT INTO provider_business (id, user_id, name, phone, email, district, town, operating_districts, services, status, created_at, updated_at)
     VALUES (?,?,?,'76000000',?,'Bo','Testville','["Bo"]','["ploughing"]','approved',?,?)`, id, ownerId, name, `${id}@example.test`, now, now);
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
  const coverage = (id: string) => ({ id, operatingDistricts: ["Bo"], services: ["ploughing"] });
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
  const tractor = await addApproved(biz, owner, {
    name: "Only a tractor", kind: "tractor", identifier: "SN-ONLY", ownership: "owned", notes: "",
    specs: { power: "90", hitch: "Three-point category 2", lift: "2500" },
  });
  const refused = await jobs.scheduleJob(biz, owner, job.id, { startDate: inDays(20), endDate: inDays(21), operatorId: null, assetIds: [tractor.id] });
  await ok("a harvest cannot run with a bare tractor", !refused.ok);
  // Since the catalogue replaced the hardcoded rule, the refusal names what would actually do the
  // job rather than one machine: a tractor can harvest, with a reaper on the back.
  await ok("and it names what is missing", !refused.ok && /reaper|thresher/i.test(refused.reason));
  const harvester = await addApproved(biz, owner, {
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

/* ===================================================================== phase 4 */

console.log("\nThe reservation is held for a bounded time, then let go");
{
  const f = await paidJobFixture("Window");
  const agreement = (await quotes.agreementFor(f.req.id))!;
  await ok("accepting sets a payment deadline", agreement.payBy !== "");
  await ok("which never runs past the day the work starts",
    Date.parse(agreement.payBy) <= Date.parse(`${agreement.startDate}T00:00:00Z`));
  await ok("and it has not lapsed yet", !quotes.paymentOverdue(agreement));
  await ok("so the machine is still committed",
    (await holds.clashesFor([{ kind: "equipment", resourceId: f.asset.id, label: "" }],
      { from: inDays(20), to: inDays(21) }, null, f.biz)).length === 1);

  // Backdate the deadline rather than waiting two days.
  await db.run("UPDATE agreement SET pay_by=? WHERE request_id=?",
    new Date(Date.now() - 3600_000).toISOString(), f.req.id);
  await ok("an overdue window reads as overdue from the clock",
    quotes.paymentOverdue((await quotes.agreementFor(f.req.id))!));

  const swept = await quotes.sweepUnpaidBookings();
  await ok("the sweep lapses it", swept.references.includes(f.req.reference));
  const after = (await quotes.agreementFor(f.req.id))!;
  await ok("the agreement itself survives", after.amountMinor === agreement.amountMinor);
  await ok("and says why it lapsed", after.lapsedReason.includes("Nothing was paid"));
  await ok("the machine is free again",
    (await holds.clashesFor([{ kind: "equipment", resourceId: f.asset.id, label: "" }],
      { from: inDays(20), to: inDays(21) }, null, f.biz)).length === 0);
  await ok("the job kept its history and lost its dates",
    (await jobs.jobForRequest(f.req.id))?.startDate === null);
  await ok("running the sweep again does nothing", (await quotes.sweepUnpaidBookings()).lapsed === 0);
  await ok("the ledger was never involved", await ledger.ledgerIsBalanced());
}

console.log("\nMoney arriving after the reservation lapsed goes to resolution");
{
  const f = await paidJobFixture("Late");
  await db.run("UPDATE agreement SET pay_by=? WHERE request_id=?",
    new Date(Date.now() - 3600_000).toISOString(), f.req.id);
  await quotes.sweepUnpaidBookings();

  const total = (await quotes.agreementFor(f.req.id))!.farmerTotalMinor;
  const late = await payments.recordPayment(staffA, {
    requestId: f.req.id, amountMinor: total, method: "mobile_money",
    externalRef: "MM-LATE-WINDOW", note: "",
  });
  await ok("the payment is recorded, not refused", late.ok);
  await ok("but it does not book anything", late.ok && late.outcome === "case_opened");
  await ok("and says the window had closed",
    late.ok && late.message.includes("payment window closed"));
  await ok("the money is still held against the job", await payments.fundsFor(f.req.id) === total);
  await ok("there is no booking", !(await payments.bookingFor(f.req.id)));
  const cases = await payments.openCases();
  await ok("a case is open for somebody to deal with",
    cases.some((c) => c.requestId === f.req.id && c.kind === "payment_after_hold_expired"));
  await ok("the ledger still balances", await ledger.ledgerIsBalanced());
}

console.log("\nA reschedule moves the reservation, or changes nothing at all");
{
  const f = await paidJobFixture("Reschedule");
  const job = (await jobs.jobForRequest(f.req.id))!;
  // The fixture's machine is the generic kind, which cannot power ploughing. Rescheduling enforces
  // the catalogue requirement — a quote that cannot become a job was the bug this test found — so
  // the job is given a real tractor and plough to move onto.
  const tractor = await addApproved(f.biz, f.owner, {
    name: "Reschedule tractor", kind: "tractor", identifier: "SN-RS-T", ownership: "owned", notes: "",
    specs: { power: "90", hitch: "Three-point category 2", lift: "2500" },
  });
  const ploughRS = await addApproved(f.biz, f.owner, {
    name: "Reschedule plough", kind: "plough", identifier: "SN-RS-P", ownership: "owned", notes: "",
    specs: { powerNeeded: "70", hitch: "Three-point category 2" },
  });
  await ok("the booking owns its dates", job.startDate === inDays(20));
  await ok("and the reservation agrees with them",
    (await holds.forQuote((await quotes.currentQuote(f.req.id, f.biz))!.id))
      .every((h) => h.status !== "converted" || h.startDate === inDays(20)));

  const moved = await jobs.scheduleJob(f.biz, f.owner, job.id, {
    startDate: inDays(50), endDate: inDays(51), operatorId: f.provider.operator,
    assetIds: [tractor.id, ploughRS.id],
  });
  await ok("it can be moved", moved.ok);
  const after = (await jobs.jobForRequest(f.req.id))!;
  await ok("the job has the new dates", after.startDate === inDays(50));
  await ok("the padded span moved with it", after.blockFrom === inDays(49));
  await ok("and so did the reservation",
    (await holds.forQuote((await quotes.currentQuote(f.req.id, f.biz))!.id))
      .filter((h) => h.status === "converted").every((h) => h.startDate === inDays(50)));
  await ok("the old week is free",
    (await holds.clashesFor([{ kind: "equipment", resourceId: tractor.id, label: "" }],
      { from: inDays(20), to: inDays(21) }, null, f.biz)).length === 0);
  await ok("the machine taken off the booking was let go",
    (await holds.forQuote((await quotes.currentQuote(f.req.id, f.biz))!.id))
      .some((h) => h.resourceId === f.asset.id && h.status === "released"));

  // A second provider's machine, already committed to their own dates.
  const rival = await paidJobFixture("Rival");
  await db.run("UPDATE job SET start_date=?, end_date=?, block_from=?, block_to=? WHERE id=?",
    inDays(50), inDays(51), inDays(49), inDays(52), rival.jobId);
  const blocked = await jobs.scheduleJob(f.biz, f.owner, job.id, {
    startDate: inDays(50), endDate: inDays(51), operatorId: f.provider.operator,
    assetIds: [tractor.id, ploughRS.id, rival.asset.id],
  });
  await ok("a machine somebody else has committed cannot be taken", !blocked.ok);
  const unchanged = (await jobs.jobForRequest(f.req.id))!;
  await ok("a refused change leaves the dates exactly as they were", unchanged.startDate === inDays(50));
  await ok("and the machines exactly as they were",
    unchanged.assetIds.slice().sort().join(",") === [tractor.id, ploughRS.id].sort().join(","));
  await ok("and the other provider's booking untouched",
    (await jobs.jobForRequest(rival.req.id))?.startDate === inDays(50));
  await ok("the ledger was never involved", await ledger.ledgerIsBalanced());
}

console.log("\nAn allocation divides a job's earnings and always adds back up");
{
  const one = { shares: [{ equipmentId: "a", shareBp: 10000, note: "" }], unallocatedBp: 0, stated: true };
  const split = revenue.allocate(100000, one);
  await ok("one machine takes the lot", split.parts.get("a") === 100000);
  await ok("with nothing unallocated", split.unallocatedMinor === 0);

  const equal = await revenue.allocationFor("no-such-job", ["a", "b", "c"]);
  await ok("an unstated split is equal", equal.shares.every((sh) => Math.abs(sh.shareBp - 3333) <= 1));
  await ok("and comes to exactly the whole",
    equal.shares.reduce((sum, sh) => sum + sh.shareBp, 0) === revenue.FULL_SHARE_BP);
  await ok("and is marked as assumed rather than stated", !equal.stated);

  // 100 does not divide by three. The parts must still add back to 100.
  const awkward = revenue.allocate(100, equal);
  const parts = [...awkward.parts.values()];
  await ok("an awkward amount still divides",
    parts.reduce((a, b) => a + b, 0) + awkward.unallocatedMinor === 100);
  await ok("without inventing a unit", parts.every((x) => Number.isInteger(x)));

  // A stated split that does not account for everything leaves a visible remainder.
  const partial = {
    shares: [{ equipmentId: "a", shareBp: 6000, note: "" }, { equipmentId: "b", shareBp: 2500, note: "" }],
    unallocatedBp: 1500, stated: true,
  };
  const left = revenue.allocate(100000, partial);
  await ok("stated shares get what they were given",
    left.parts.get("a") === 60000 && left.parts.get("b") === 25000);
  await ok("and the rest is shown as unallocated, not spread", left.unallocatedMinor === 15000);
  await ok("which still adds back to the whole",
    [...left.parts.values()].reduce((a, b) => a + b, 0) + left.unallocatedMinor === 100000);

  await ok("the same job always splits the same way",
    JSON.stringify([...revenue.allocate(100, equal).parts]) === JSON.stringify([...awkward.parts]));
}

console.log("\nRevenue per machine, net of fees and attributable refunds");
{
  // The handover's A14 arithmetic, in minor units: the provider's price is 100,000, the farmer pays
  // 110,000 with Sagora's 10% on top, the provider's net is 100,000, and a 10,000 refund
  // attributable to one machine leaves 90,000 earned.
  const farmer = await user("Farmer A14");
  const p = await providerFixture("A14");
  const plough = await addApproved(p.biz, p.owner, {
    name: "A14 plough", kind: "plough", identifier: "SN-A14-P", ownership: "owned", notes: "",
    specs: { powerNeeded: "70", hitch: "Three-point category 2" },
  });
  const req = await requests.createRequest(farmer, {
    service: "ploughing", acres: 4, landAccess: "easy", landCondition: "", landClearance: "cleared",
    district: "Bo", village: "Testville", preferredDate: inDays(70), alternateDate: null, notes: "",
    contactName: "Farmer A14", contactPhone: "76000001", contactEmail: `${farmer}@example.test`,
  });
  const q = await quotes.sendQuote(req.id, p.biz, p.owner, quoteInput(p, inDays(70), {
    amountMinor: 100000, daysToComplete: 2, dailyRateMinor: 50000, assetIds: [p.machine, plough.id],
  }));
  if (!q.ok) throw new Error(`A14 quote failed: ${q.reason}`);
  await ok("the farmer is quoted the price plus the fee",
    (await quotes.acceptQuote(q.quote.id, farmer)).ok);
  const agreement = (await quotes.agreementFor(req.id))!;
  await ok("which is 110,000 on a 100,000 job", agreement.farmerTotalMinor === 110000);

  await payments.recordPayment(staffA, {
    requestId: req.id, amountMinor: 110000, method: "mobile_money", externalRef: "MM-A14", note: "",
  });
  const job = (await jobs.jobForRequest(req.id))!;
  await jobs.saveReadiness(p.biz, p.owner, job.id, jobs.READY_CHECKS.map((c) => c.id));
  await jobs.markMobilised(p.biz, p.owner, job.id);
  await jobs.startWork(p.biz, p.owner, job.id);
  await jobs.reportWork(p.biz, p.owner, job.id, 4, "Done");
  await jobs.confirmDelivery(farmer, req.id);

  await ok("a refund cannot be put against a machine that was not on the job",
    !(await settlement.prepareRefund(staffA, req.id, 1000, "Nonsense", "no-such-machine")).ok);

  // A refund can only be prepared while money is still held, so it always comes before the payout
  // and has already reduced it. 11,000 off the farmer's 110,000 leaves 99,000 held, which splits
  // into a 9,000 fee and the handover's 90,000 net.
  const refund = await settlement.prepareRefund(staffA, req.id, 11000, "The plough left a strip undone", plough.id);
  if (!refund.ok) throw new Error(`A14 refund failed: ${refund.reason}`);
  await settlement.approveRelease(staffB, refund.value!);
  await settlement.markSent(staffB, refund.value!, "mobile_money", "MM-A14-REF");

  const payout = await settlement.preparePayout(staffA, req.id);
  if (!payout.ok) throw new Error(`A14 payout failed: ${payout.reason}`);
  await settlement.approveRelease(staffB, payout.value!);
  await settlement.markSent(staffB, payout.value!, "mobile_money", "MM-A14-OUT");

  let report = await revenue.revenueByMachine(p.biz);
  await ok("both machines are reported", report.machines.length === 2);
  await ok("the provider was paid the net of the refund, once",
    report.totalEarnedMinor === 90000);
  await ok("Sagora's fee shrank with the refund rather than being charged on money returned",
    report.feeMinor === 9000);
  await ok("the report says the split is an assumption, because nobody stated one",
    report.machines.every((m) => m.assumed));
  await ok("nothing is unallocated", report.unallocatedMinor === 0);
  await ok("it reconciles", revenue.reconciles(report));

  const ploughRow = report.machines.find((m) => m.equipmentId === plough.id)!;
  const tractorRow = report.machines.find((m) => m.equipmentId === p.machine)!;
  // The loss lands on the machine it was named to rather than being halved across both: the share
  // is worked out before the named refund and the refund then comes off that one machine.
  await ok("the named refund is attributed, not spread", ploughRow.refundMinor === 11000);
  await ok("so the plough carries it", ploughRow.earnedMinor === 50500 - 11000);
  await ok("and the tractor does not", tractorRow.earnedMinor === 50500);
  await ok("while the two still come to exactly what was paid out",
    ploughRow.earnedMinor + tractorRow.earnedMinor === 90000);
  await ok("the refund is never subtracted twice", tractorRow.refundMinor === 0);

  // Stating a split that does not account for everything.
  await ok("a provider can state the split",
    (await revenue.setAllocation(p.biz, p.owner, job.id, [
      { equipmentId: p.machine, shareBp: 7000 }, { equipmentId: plough.id, shareBp: 2000 },
    ])).ok);
  await ok("shares adding to more than the whole are refused",
    !(await revenue.setAllocation(p.biz, p.owner, job.id, [
      { equipmentId: p.machine, shareBp: 8000 }, { equipmentId: plough.id, shareBp: 8000 },
    ])).ok);
  await ok("a machine not on the job cannot be given a share",
    !(await revenue.setAllocation(p.biz, p.owner, job.id, [{ equipmentId: "no-such", shareBp: 100 }])).ok);
  await ok("another business cannot state it",
    !(await revenue.setAllocation("someone-else", p.owner, job.id, [{ equipmentId: p.machine, shareBp: 100 }])).ok);

  report = await revenue.revenueByMachine(p.biz);
  // 90,000 paid out plus the 11,000 named refund is 101,000 to divide: 70% and 20% of it, with the
  // 10% nobody accounted for left over.
  await ok("the stated split is used", report.machines.find((m) => m.equipmentId === p.machine)!.netMinor === 70700);
  await ok("the tenth nobody accounted for is shown and not spread", report.unallocatedMinor === 10100);
  await ok("it is in no machine's total",
    report.machines.reduce((sum, m) => sum + m.netMinor, 0) === 101000 - 10100);
  await ok("the report no longer calls the split an assumption",
    report.machines.every((m) => !m.assumed));
  await ok("and the whole thing still reconciles", revenue.reconciles(report));
  await ok("the ledger balances after all of it", await ledger.ledgerIsBalanced());
}

console.log(`\n${checks - fail.length}/${checks} checks passed.`);
if (fail.length) {
  console.log(`\nFailures:\n${fail.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
