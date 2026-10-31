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
  const owner = await user(`Owner ${label}`, "provider");
  const biz = await business(owner, `Business ${label}`);
  const req = await requests.createRequest(farmer, {
    service: "ploughing", acres: 4, landAccess: "easy", landCondition: "", landClearance: "cleared", district: "Bo", village: "Testville",
    preferredDate: inDays(20), alternateDate: null, notes: "",
    contactName: `Farmer ${label}`, contactPhone: "76000001", contactEmail: `${farmer}@example.test`,
  });
  const quote = await quotes.sendQuote(req.id, biz, owner, {
    amountMinor: 150000, includes: "Tractor and plough", startDate: inDays(20),
    validUntil: inDays(10), note: "",
  });
  if (!quote.ok) throw new Error(`fixture quote failed: ${quote.reason}`);
  const accepted = await quotes.acceptQuote(quote.quote.id, farmer);
  if (!accepted.ok) throw new Error(`fixture accept failed: ${accepted.reason}`);
  const asset = await equipment.addAsset(biz, owner, {
    name: `Tractor ${label}`, kind: "machine", identifier: "", ownership: "owned", notes: "",
  });
  const job = (await jobs.jobForRequest(req.id))!;
  const sched = await jobs.scheduleJob(biz, owner, job.id, {
    startDate: inDays(20), endDate: inDays(21), operatorId: null, assetIds: [asset.id],
  });
  if (!sched.ok) throw new Error(`fixture schedule failed: ${sched.reason}`);
  return { farmer, owner, biz, req, asset, jobId: job.id };
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

  const rest = await payments.recordPayment(staffA, {
    requestId: paid.req.id, amountMinor: 100000, method: "bank", externalRef: "BK-0002", note: "",
  });
  await ok("paying the balance books the job", rest.ok && rest.outcome === "booked");
  await ok("the booking exists", (await payments.bookingFor(paid.req.id))?.amountMinor === 150000);

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
  const q2 = await quotes.sendQuote(other.id, late.biz, late.owner, {
    amountMinor: 50000, includes: "Tractor", startDate: inDays(20), validUntil: inDays(10), note: "",
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
  await ok("the provider is owed the net", await ledger.balance(`payable:${paid.biz}`) === 150000);

  // Changing the amount must invalidate the approval.
  await ok("the amount can be revised", (await settlement.reviseAmount(staffB, id, 140000)).ok);
  await ok("revising sent it back for approval", (await settlement.getRelease(id))?.status === "prepared");
  await ok("revising undid what was owed", await ledger.balance(`payable:${paid.biz}`) === 0);
  await ok("sending is refused while unapproved", !(await settlement.markSent(staffB, id, "bank", "BK-OUT-1")).ok);

  await settlement.approveRelease(staffB, id);
  await ok("sending works once re-approved", (await settlement.markSent(staffB, id, "bank", "BK-OUT-1")).ok);
  await ok("nothing is left owed", await ledger.balance(`payable:${paid.biz}`) === 0);
  await ok("10,000 is still held after a 140,000 payout", await payments.fundsFor(paid.req.id) === 10000);
  await ok("the ledger still balances", await ledger.ledgerIsBalanced());
}

console.log("\nFees and reconciliation");
{
  await ok("no fee is charged while the pilot rate is unapproved", settlement.feeFor(150000, 50) === 0);
  const live = { ...settlement.FEE_POLICY };
  settlement.FEE_POLICY.approved = true;
  await ok("the first 20 jobs are free", settlement.feeFor(150000, 3) === 0);
  await ok("10% applies after that", settlement.feeFor(150000, 20) === 15000);
  await ok("the fee rounds down", settlement.feeFor(1005, 20) === 100);
  settlement.FEE_POLICY.approved = live.approved;

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

console.log(`\n${checks - fail.length}/${checks} checks passed.`);
if (fail.length) {
  console.log(`\nFailures:\n${fail.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
