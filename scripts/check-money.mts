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
function ok(what: string, condition: boolean) {
  checks++;
  if (condition) console.log(`  ok   ${what}`);
  else {
    console.log(`  FAIL ${what}`);
    fail.push(what);
  }
}
function throws(what: string, fn: () => unknown) {
  checks++;
  try {
    fn();
    console.log(`  FAIL ${what} (did not throw)`);
    fail.push(what);
  } catch {
    console.log(`  ok   ${what}`);
  }
}



const now = new Date().toISOString();
const inDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

function user(name: string, role = "farmer") {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO user (id, name, email, emailVerified, role, createdAt, updatedAt)
     VALUES (?,?,?,1,?,?,?)`,
  ).run(id, name, `${id}@example.test`, role, now, now);
  return id;
}
function business(ownerId: string, name: string) {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO provider_business (id, user_id, name, phone, email, district, town, services, status, created_at, updated_at)
     VALUES (?,?,?,'76000000',?,'Bo','Testville','["ploughing"]','approved',?,?)`,
  ).run(id, ownerId, name, `${id}@example.test`, now, now);
  return id;
}

// A whole job, from request to agreement to a scheduled machine.
function paidJobFixture(label: string) {
  const farmer = user(`Farmer ${label}`);
  const owner = user(`Owner ${label}`, "provider");
  const biz = business(owner, `Business ${label}`);
  const req = requests.createRequest(farmer, {
    service: "ploughing", acres: 4, district: "Bo", village: "Testville",
    preferredDate: inDays(20), alternateDate: null, notes: "",
    contactName: `Farmer ${label}`, contactPhone: "76000001", contactEmail: `${farmer}@example.test`,
  });
  const quote = quotes.sendQuote(req.id, biz, owner, {
    amountMinor: 150000, includes: "Tractor and plough", startDate: inDays(20),
    validUntil: inDays(10), note: "",
  });
  if (!quote.ok) throw new Error(`fixture quote failed: ${quote.reason}`);
  const accepted = quotes.acceptQuote(quote.quote.id, farmer);
  if (!accepted.ok) throw new Error(`fixture accept failed: ${accepted.reason}`);
  const asset = equipment.addAsset(biz, owner, {
    name: `Tractor ${label}`, kind: "machine", identifier: "", ownership: "owned", notes: "",
  });
  const job = jobs.jobForRequest(req.id)!;
  const sched = jobs.scheduleJob(biz, owner, job.id, {
    startDate: inDays(20), endDate: inDays(21), operatorId: null, assetIds: [asset.id],
  });
  if (!sched.ok) throw new Error(`fixture schedule failed: ${sched.reason}`);
  return { farmer, owner, biz, req, asset, jobId: job.id };
}

console.log("\nLedger");
{
  const ref = { type: "test", id: randomUUID() };
  throws("entries that do not sum to zero are refused", () =>
    ledger.post([{ account: "a", amountMinor: 100 }, { account: "b", amountMinor: -99 }], ref),
  );
  throws("fractional minor units are refused", () =>
    ledger.post([{ account: "a", amountMinor: 1.5 }, { account: "b", amountMinor: -1.5 }], ref),
  );
  const txn = ledger.post([{ account: "test:a", amountMinor: 500 }, { account: "test:b", amountMinor: -500 }], ref);
  ok("a balanced transaction posts", ledger.balance("test:a") === 500);
  ledger.reverse(txn, "mistake");
  ok("a reversal returns the balance to zero", ledger.balance("test:a") === 0);
  ok("the reversal leaves both entries in place", ledger.entriesFor(ref.type, ref.id).length === 4);
  ok("the whole ledger balances", ledger.ledgerIsBalanced());
}

console.log("\nPayments");
const paid = paidJobFixture("paid");
const staffA = user("Staff A", "staff");
const staffB = user("Staff B", "staff");
{
  const part = payments.recordPayment(staffA, {
    requestId: paid.req.id, amountMinor: 50000, method: "mobile_money", externalRef: "MM-0001", note: "",
  });
  ok("a part payment is recorded", part.ok && part.outcome === "part_paid");
  ok("a part payment does not book the job", payments.bookingFor(paid.req.id) === null);

  const again = payments.recordPayment(staffA, {
    requestId: paid.req.id, amountMinor: 50000, method: "mobile_money", externalRef: "MM-0001", note: "",
  });
  ok("the same receipt reference cannot be recorded twice", !again.ok);
  ok("the duplicate added no money", payments.fundsFor(paid.req.id) === 50000);

  const rest = payments.recordPayment(staffA, {
    requestId: paid.req.id, amountMinor: 100000, method: "bank", externalRef: "BK-0002", note: "",
  });
  ok("paying the balance books the job", rest.ok && rest.outcome === "booked");
  ok("the booking exists", payments.bookingFor(paid.req.id)?.amountMinor === 150000);

  const third = payments.recordPayment(staffA, {
    requestId: paid.req.id, amountMinor: 1000, method: "cash", externalRef: "CA-0003", note: "",
  });
  ok("a booked job refuses further payment", !third.ok);
  ok("the ledger still balances", ledger.ledgerIsBalanced());
}

console.log("\nPayment received, booking not confirmed");
{
  const late = paidJobFixture("late");
  // Something else takes the machine for those dates, so capacity is gone when money arrives.
  const other = requests.createRequest(late.farmer, {
    service: "ploughing", acres: 2, district: "Bo", village: "Testville",
    preferredDate: inDays(20), alternateDate: null, notes: "",
    contactName: "Other", contactPhone: "76000002", contactEmail: `${late.farmer}@example.test`,
  });
  const q2 = quotes.sendQuote(other.id, late.biz, late.owner, {
    amountMinor: 50000, includes: "Tractor", startDate: inDays(20), validUntil: inDays(10), note: "",
  });
  if (!q2.ok) throw new Error(q2.reason);
  quotes.acceptQuote(q2.quote.id, late.farmer);
  const otherJob = jobs.jobForRequest(other.id)!;
  const taken = jobs.scheduleJob(late.biz, late.owner, otherJob.id, {
    startDate: inDays(20), endDate: inDays(21), operatorId: null, assetIds: [late.asset.id],
  });
  ok("a second job cannot hold the same machine for the same dates", !taken.ok);

  // Force the clash the way reality would: the machine is moved onto the other job directly.
  db.prepare("UPDATE job SET status='scheduled', start_date=?, end_date=? WHERE id=?")
    .run(inDays(20), inDays(21), otherJob.id);
  db.prepare("INSERT INTO job_asset (job_id, equipment_id) VALUES (?,?)").run(otherJob.id, late.asset.id);

  const res = payments.recordPayment(staffA, {
    requestId: late.req.id, amountMinor: 150000, method: "mobile_money", externalRef: `MM-${randomUUID()}`, note: "",
  });
  ok("money arriving after capacity is lost opens a case", res.ok && res.outcome === "case_opened");
  ok("nothing was overbooked", payments.bookingFor(late.req.id) === null);
  ok("the money is still held", payments.fundsFor(late.req.id) === 150000);
  ok("the case is in the staff queue", payments.openCases().some((c) => c.requestId === late.req.id));

  // The way out of that case is a refund.
  const prep = settlement.prepareRefund(staffA, late.req.id, 150000, "Machine was no longer free");
  ok("a refund can be prepared", prep.ok);
  throws("the preparer cannot approve their own refund", () => {
    const r = settlement.approveRelease(staffA, (prep as { value: string }).value);
    if (!r.ok) throw new Error(r.reason);
  });
  const appr = settlement.approveRelease(staffB, (prep as { value: string }).value);
  ok("a second person can approve it", appr.ok);
  const sent = settlement.markSent(staffB, (prep as { value: string }).value, "mobile_money", "MM-REFUND-1");
  ok("the refund is sent", sent.ok);
  ok("the money is no longer held", payments.fundsFor(late.req.id) === 0);
  ok("the ledger still balances", ledger.ledgerIsBalanced());
}

console.log("\nPayout");
{
  const early = settlement.preparePayout(staffA, paid.req.id);
  ok("no payout before the farmer confirms delivery", !early.ok);

  jobs.startWork(paid.biz, paid.owner, paid.jobId);
  jobs.reportWork(paid.biz, paid.owner, paid.jobId, 4, "Done");
  const reported = settlement.preparePayout(staffA, paid.req.id);
  ok("a reported job is not a confirmed one", !reported.ok);

  jobs.confirmDelivery(paid.farmer, paid.req.id);
  const prep = settlement.preparePayout(staffA, paid.req.id);
  ok("a confirmed job can be paid out", prep.ok);
  const id = (prep as { value: string }).value;

  const second = settlement.preparePayout(staffA, paid.req.id);
  ok("a second payout cannot be prepared alongside the first", !second.ok);

  const selfApprove = settlement.approveRelease(staffA, id);
  ok("the preparer cannot approve their own payout", !selfApprove.ok);

  ok("approval by a second person works", settlement.approveRelease(staffB, id).ok);
  ok("the provider is owed the net", ledger.balance(`payable:${paid.biz}`) === 150000);

  // Changing the amount must invalidate the approval.
  ok("the amount can be revised", settlement.reviseAmount(staffB, id, 140000).ok);
  ok("revising sent it back for approval", settlement.getRelease(id)?.status === "prepared");
  ok("revising undid what was owed", ledger.balance(`payable:${paid.biz}`) === 0);
  ok("sending is refused while unapproved", !settlement.markSent(staffB, id, "bank", "BK-OUT-1").ok);

  settlement.approveRelease(staffB, id);
  ok("sending works once re-approved", settlement.markSent(staffB, id, "bank", "BK-OUT-1").ok);
  ok("nothing is left owed", ledger.balance(`payable:${paid.biz}`) === 0);
  ok("10,000 is still held after a 140,000 payout", payments.fundsFor(paid.req.id) === 10000);
  ok("the ledger still balances", ledger.ledgerIsBalanced());
}

console.log("\nFees and reconciliation");
{
  ok("no fee is charged while the pilot rate is unapproved", settlement.feeFor(150000, 50) === 0);
  const live = { ...settlement.FEE_POLICY };
  settlement.FEE_POLICY.approved = true;
  ok("the first 20 jobs are free", settlement.feeFor(150000, 3) === 0);
  ok("10% applies after that", settlement.feeFor(150000, 20) === 15000);
  ok("the fee rounds down", settlement.feeFor(1005, 20) === 100);
  settlement.FEE_POLICY.approved = live.approved;

  const r = settlement.reconcile();
  ok("reconciliation reports a balanced ledger", r.balanced);
  ok("no account is negative", r.negativeAccounts.length === 0);
  ok("money held on a finished job is flagged", r.heldAfterCompletion.some((h) => h.requestId === paid.req.id));
}

console.log(`\n${checks - fail.length}/${checks} checks passed.`);
if (fail.length) {
  console.log(`\nFailures:\n${fail.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
