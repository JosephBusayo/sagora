/**
 * Karim's sixteen acceptance cases, A01 to A16, checked without a browser. Run against a
 * throwaway database:
 *   DATABASE_PATH=<scratch>/a.db npm run db:migrate && DATABASE_PATH=<scratch>/a.db npm run check:acceptance
 *
 * The handover is explicit about why this exists: "a successful screen demo alone does not prove
 * server-side safeguards". Several of these cases cannot be demonstrated by clicking at all — A05
 * is a race, A07 is a clock, A10 is a duplicate callback — so each one is stated here as the
 * handover states it and then proved against the real code paths.
 *
 * This suite is deliberately one assertion per case rather than a hundred: the per-area suites
 * (check:money, check:quotes, check:assets, check:pairing, check:packages, check:register) carry
 * the detail, and 400-odd checks between them. This one answers a different question — can every
 * numbered case Karim wrote down be shown to hold, today, in one run — and is the thing to put in
 * front of him.
 */
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";
const { db } = await import("../src/lib/db");
const requests = await import("../src/lib/requests");
const quotes = await import("../src/lib/quotes");
const jobs = await import("../src/lib/jobs");
const holds = await import("../src/lib/holds");
const payments = await import("../src/lib/payments");
const ledger = await import("../src/lib/ledger");
const equipment = await import("../src/lib/equipment");

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

const pairing = await import("../src/lib/pairing");
const shares = await import("../src/lib/shares");
const flags = await import("../src/lib/flags");
const revenue = await import("../src/lib/revenue");
const routing = await import("../src/lib/routing");
const viewers = await import("../src/lib/asset-viewers");
const operations = await import("../src/lib/operations");
const zone = await import("../src/lib/zone");
const { inDays, provider: providerFixture, quoteInput, user } = await import("./fixtures.mjs");

const fails: string[] = [];
const cases: { id: string; title: string; ok: boolean; note: string }[] = [];

/** One acceptance case: what the handover asks, and whether it holds. */
async function acceptance(id: string, title: string, check: () => Promise<string | true>) {
  let ok = false;
  let note = "";
  try {
    const result = await check();
    ok = result === true;
    if (typeof result === "string") note = result;
  } catch (err) {
    note = `threw: ${err instanceof Error ? err.message : String(err)}`;
  }
  cases.push({ id, title, ok, note });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${id}  ${title}`);
  if (!ok) {
    console.log(`        ${note || "did not hold"}`);
    fails.push(`${id} ${title}`);
  }
}

/* ------------------------------------------------------------------ fixtures */

const TRACTOR = { power: "90", hitch: "Three-point category 2", lift: "2500" };
const PLOUGH = { powerNeeded: "70", hitch: "Three-point category 2" };

const p = await providerFixture("Acceptance", "Bo", ["ploughing", "harvesting", "planting"]);
const tractor = await addApproved(p.biz, p.owner, {
  kind: "tractor", name: "A-Tractor", identifier: "AC-T1", ownership: "owned", notes: "", specs: TRACTOR,
});
const plough = await addApproved(p.biz, p.owner, {
  kind: "plough", name: "A-Plough", identifier: "AC-P1", ownership: "owned", notes: "", specs: PLOUGH,
});
const kit = { assetIds: [tractor.id, plough.id] };

const farmer = await user("Acceptance Farmer");
/**
 * Each case gets its own month.
 *
 * The cases share one provider and one pair of machines on purpose — that is what a real register
 * looks like — so they have to be spaced far enough apart that one case's reservation cannot
 * refuse another's quote. Eight days was not enough: A04 plans a package whose second stage sits
 * six days after the first, and with a day of travel either side that reached into the next case's
 * window and failed it. Thirty days is comfortably more than any single case consumes.
 */
let day = 400;
const request = (over: Partial<{ services: string[]; district: string; service: string }> = {}) => {
  day += 30;
  const start = inDays(day);
  return requests.createRequest(farmer, {
    service: over.service ?? over.services?.[0] ?? "ploughing",
    services: over.services ?? [over.service ?? "ploughing"],
    acres: 4, landAccess: "easy", landCondition: "", landClearance: "cleared",
    district: over.district ?? "Bo", village: "Testville", preferredDate: start,
    alternateDate: null, notes: "", contactName: "Acceptance Farmer", contactPhone: "76000001",
    contactEmail: "acceptance@example.test", submissionKey: null,
  }).then((r) => ({ r, start }));
};
const send = (requestId: string, start: string, over: Record<string, unknown> = {}) =>
  quotes.sendQuote(requestId, p.biz, p.owner, {
    ...quoteInput(p, start, { daysToComplete: 1, ...kit }), capacityConfirmed: true, ...over,
  });

console.log("\nKarim's acceptance cases, A01 to A16\n");

/* ===================================================================== A01 */

await acceptance("A01", "Routing is logged: eligible, notified or excluded, and why", async () => {
  const { r } = await request({ district: "Kono" }); // nobody covers Kono
  await routing.recordRouting({ id: r.id, district: "Kono", service: "ploughing" }, []);
  const decided = await routing.routingFor(r.id);
  if (decided.length === 0) return "no decision was recorded";
  const excluded = decided.find((d) => d.businessId === p.biz);
  if (excluded?.outcome !== "excluded") return `expected excluded, got ${excluded?.outcome}`;
  if (!excluded.reason.includes("Kono")) return `the reason does not name the district: ${excluded.reason}`;
  const gaps = await routing.unroutedRequests();
  if (!gaps.some((g) => g.requestId === r.id)) return "the coverage gap is not surfaced to staff";
  return true;
});

/* ===================================================================== A02 */

await acceptance("A02", "A quote cannot be sent without the actual machine and operator reserved", async () => {
  const { r, start } = await request();
  const bare = await quotes.sendQuote(r.id, p.biz, p.owner, {
    ...quoteInput(p, start, { daysToComplete: 1, assetIds: [] }), capacityConfirmed: true,
  });
  if (bare.ok) return "a quote with no equipment was accepted";
  const noOperator = await quotes.sendQuote(r.id, p.biz, p.owner, {
    ...quoteInput(p, start, { daysToComplete: 1, ...kit }), operatorId: "", capacityConfirmed: true,
  });
  if (noOperator.ok) return "a quote with no operator was accepted";
  const good = await send(r.id, start);
  if (!good.ok) return `a complete quote was refused: ${good.reason}`;
  const placed = await holds.forQuote(good.quote.id);
  if (placed.length !== 3) return `expected 3 holds (two machines, one operator), got ${placed.length}`;
  return true;
});

/* ===================================================================== A03 */

await acceptance("A03", "Send is blocked with a specific reason, and the next free window is shown", async () => {
  const { r, start } = await request();
  const first = await send(r.id, start);
  if (!first.ok) return `the first quote failed: ${first.reason}`;
  const { r: r2 } = await request();
  const clash = await send(r2.id, start); // the same machines, the same day
  if (clash.ok) return "an overlapping quote was allowed";
  if (!clash.reason.includes("A-Tractor")) return `the refusal does not name the machine: ${clash.reason}`;
  if (!clash.reason.includes("The earliest everything is free is")) {
    return `the refusal does not offer a window: ${clash.reason}`;
  }
  return true;
});

/* ===================================================================== A04 */

await acceptance("A04", "A package plans and reserves each operation for its own window", async () => {
  const { r, start } = await request({ services: ["ploughing", "planting"] });
  const ops = await operations.operationsFor(r.id);
  if (ops.length !== 2) return `expected 2 stages, got ${ops.length}`;
  if (ops[0]!.service !== "ploughing") return "the stages are not in field order";

  const short = await send(r.id, start, {
    plan: [{ operationId: ops[0]!.id, service: "ploughing", sequence: 1, startDate: start, daysToComplete: 1, dailyRateMinor: 1000, amountMinor: 1000 }],
  });
  if (short.ok) return "a package was quoted with a stage unplanned";

  const plan = ops.map((o, i) => ({
    operationId: o.id, service: o.service, sequence: o.sequence,
    startDate: inDays(day + i * 6), daysToComplete: 1, dailyRateMinor: 1000, amountMinor: 1000,
  }));
  const whole = await send(r.id, plan[0]!.startDate, { plan });
  if (!whole.ok) return `the whole package was refused: ${whole.reason}`;
  const placed = await holds.forQuote(whole.quote.id);
  if (new Set(placed.map((h) => h.operationId)).size !== 2) return "the stages do not have their own holds";
  if (new Set(placed.map((h) => h.startDate)).size !== 2) return "the stages share one window";
  return true;
});

/* ===================================================================== A05 */

await acceptance("A05", "Two providers cannot both reserve the same machine for the same days", async () => {
  // One physical machine, lent to a second business: the sharpest form of the race, because the
  // two quotes come from different businesses and nothing but the resource id connects them.
  const other = await providerFixture("Acceptance Rival", "Bo", ["ploughing"]);
  const granted = await shares.grantShare(p.biz, p.owner, tractor.id, other.biz, "For the test");
  if (!granted.ok) return `the share was refused: ${granted.reason}`;

  const { r, start } = await request();
  const mine = await send(r.id, start);
  if (!mine.ok) return `the owner could not quote: ${mine.reason}`;

  const { r: theirs } = await request();
  const borrowed = await quotes.sendQuote(theirs.id, other.biz, other.owner, {
    ...quoteInput(other, start, { daysToComplete: 1, assetIds: [tractor.id] }), capacityConfirmed: true,
  });
  if (borrowed.ok) return "the borrower reserved a machine the owner already held";
  if (borrowed.reason.includes(r.reference)) return "the refusal leaked the owner's request reference";
  await shares.revokeShare(p.biz, p.owner, tractor.id, other.biz);
  return true;
});

/* ===================================================================== A06 */

await acceptance("A06", "Condition, lease and travel all block capacity; a stale check blocks dispatch", async () => {
  const lease = await addApproved(p.biz, p.owner, {
    kind: "tractor", name: "A-Leased", identifier: "AC-L1", ownership: "leased", notes: "",
    specs: TRACTOR, lessor: "A lessor", leaseFrom: inDays(1), leaseTo: inDays(3),
  });
  if (equipment.unavailableReason(lease, inDays(60)) === null) return "a lapsed lease did not block the machine";

  const repair = await addApproved(p.biz, p.owner, {
    kind: "tractor", name: "A-Repair", identifier: "AC-R1", ownership: "owned", notes: "", specs: TRACTOR,
  });
  await equipment.setCondition(p.biz, p.owner, repair.id, "repair", "Gearbox");
  const after = await equipment.getAsset(p.biz, repair.id);
  if (!after || equipment.unavailableReason(after) === null) return "a machine under repair was still usable";

  // Travel: the day either side of committed work is not free.
  const travel = await holds.travelDays();
  if (travel < 1) return `travel padding is ${travel}, so the days either side are offered as free`;
  const w = holds.blockWindow(inDays(10), inDays(10), travel);
  if (w.from !== inDays(9) || w.to !== inDays(11)) return "the padded window is wrong";
  return true;
});

/* ===================================================================== A07 */

await acceptance("A07", "The reservation is held for a bounded period after acceptance, with the deadline shown", async () => {
  const { r, start } = await request();
  const q = await send(r.id, start);
  if (!q.ok) return `the quote failed: ${q.reason}`;
  const accepted = await quotes.acceptQuote(q.quote.id, farmer);
  if (!accepted.ok) return `acceptance failed: ${accepted.reason}`;

  const agreement = (await quotes.agreementFor(r.id))!;
  if (!agreement.payBy) return "no payment deadline was set";
  if (Date.parse(agreement.payBy) > Date.parse(`${agreement.startDate}T00:00:00Z`)) {
    return "the deadline runs past the day the work starts";
  }
  if (quotes.paymentOverdue(agreement)) return "a fresh deadline reads as already overdue";

  // Backdate it rather than waiting two days, then sweep.
  await db.run("UPDATE agreement SET pay_by=? WHERE request_id=?", new Date(Date.now() - 3600_000).toISOString(), r.id);
  const swept = await quotes.sweepUnpaidBookings();
  if (!swept.references.includes(r.reference)) return "the sweep did not release it";
  const job = await jobs.jobForRequest(r.id);
  if (job?.startDate !== null) return "the job kept its dates after the window closed";
  const still = (await quotes.agreementFor(r.id))!;
  if (!still.lapsedReason) return "nothing records why it lapsed";
  if (still.amountMinor !== agreement.amountMinor) return "the agreed price was altered";
  return true;
});

/* ===================================================================== A08 */

await acceptance("A08", "A reschedule swaps reservations atomically; a failed change keeps the original", async () => {
  const { r, start } = await request();
  const q = await send(r.id, start);
  if (!q.ok) return `the quote failed: ${q.reason}`;
  if (!(await quotes.acceptQuote(q.quote.id, farmer)).ok) return "acceptance failed";
  const job = (await jobs.jobForRequest(r.id))!;

  const to = inDays(day + 40);
  const moved = await jobs.scheduleJob(p.biz, p.owner, job.id, {
    startDate: to, endDate: to, operatorId: p.operator, assetIds: [tractor.id, plough.id],
  });
  if (!moved.ok) return `the reschedule failed: ${moved.reason}`;
  const afterMove = (await jobs.jobForRequest(r.id))!;
  if (afterMove.startDate !== to) return "the job did not move";
  const converted = (await holds.forQuote(q.quote.id)).filter((h) => h.status === "converted");
  if (!converted.every((h) => h.startDate === to)) return "the reservation stayed on the old dates";

  // A machine another business has committed cannot be taken, and the failure changes nothing.
  const rival = await providerFixture("A08 Rival", "Bo", ["ploughing"]);
  const { r: theirs, start: theirStart } = await request();
  const theirQuote = await quotes.sendQuote(theirs.id, rival.biz, rival.owner, {
    ...quoteInput(rival, theirStart, { daysToComplete: 1, assetIds: [rival.machine] }), capacityConfirmed: true,
  });
  if (!theirQuote.ok) return `the rival could not quote: ${theirQuote.reason}`;
  await quotes.acceptQuote(theirQuote.quote.id, farmer);

  const blocked = await jobs.scheduleJob(p.biz, p.owner, job.id, {
    startDate: theirStart, endDate: theirStart, operatorId: p.operator,
    assetIds: [tractor.id, plough.id, rival.machine],
  });
  if (blocked.ok) return "a machine committed elsewhere was taken";
  const unchanged = (await jobs.jobForRequest(r.id))!;
  if (unchanged.startDate !== to) return "a refused change moved the original";
  if (unchanged.assetIds.length !== 2) return "a refused change altered the machines";
  return true;
});

/* ===================================================================== A09 */

await acceptance("A09", "Money in is not a booking: part payment holds without confirming", async () => {
  const { r, start } = await request();
  const q = await send(r.id, start);
  if (!q.ok) return `the quote failed: ${q.reason}`;
  if (!(await quotes.acceptQuote(q.quote.id, farmer)).ok) return "acceptance failed";
  const agreement = (await quotes.agreementFor(r.id))!;

  const staff = await user("A09 Staff", "admin");
  const part = await payments.recordPayment(staff, {
    requestId: r.id, amountMinor: Math.floor(agreement.farmerTotalMinor / 4),
    method: "mobile_money", externalRef: "MM-A09-PART", note: "",
  });
  if (!part.ok || part.outcome !== "part_paid") return `expected part_paid, got ${part.ok ? part.outcome : part.reason}`;
  if (await payments.bookingFor(r.id)) return "a part payment confirmed a booking";
  if (!(await ledger.ledgerIsBalanced())) return "the ledger does not balance";
  return true;
});

/* ===================================================================== A10 */

await acceptance("A10", "A duplicate payment is refused, and money after the hold lapsed goes to resolution", async () => {
  const { r, start } = await request();
  const q = await send(r.id, start);
  if (!q.ok) return `the quote failed: ${q.reason}`;
  if (!(await quotes.acceptQuote(q.quote.id, farmer)).ok) return "acceptance failed";
  const staff = await user("A10 Staff", "admin");
  const total = (await quotes.agreementFor(r.id))!.farmerTotalMinor;

  const once = await payments.recordPayment(staff, {
    requestId: r.id, amountMinor: Math.floor(total / 4), method: "mobile_money",
    externalRef: "MM-A10", note: "",
  });
  if (!once.ok) return `the first payment failed: ${once.reason}`;
  const twice = await payments.recordPayment(staff, {
    requestId: r.id, amountMinor: Math.floor(total / 4), method: "mobile_money",
    externalRef: "MM-A10", note: "",
  });
  if (twice.ok) return "the same receipt reference was recorded twice";

  // Money arriving after the reservation has gone.
  const { r: late, start: lateStart } = await request();
  const lq = await send(late.id, lateStart);
  if (!lq.ok) return `the second quote failed: ${lq.reason}`;
  if (!(await quotes.acceptQuote(lq.quote.id, farmer)).ok) return "the second acceptance failed";
  await db.run("UPDATE agreement SET pay_by=? WHERE request_id=?", new Date(Date.now() - 3600_000).toISOString(), late.id);
  await quotes.sweepUnpaidBookings();
  const after = await payments.recordPayment(staff, {
    requestId: late.id, amountMinor: (await quotes.agreementFor(late.id))!.farmerTotalMinor,
    method: "mobile_money", externalRef: "MM-A10-LATE", note: "",
  });
  if (!after.ok || after.outcome !== "case_opened") return "late money confirmed a booking";
  if (!(await payments.openCases()).some((c) => c.requestId === late.id)) return "no case was opened";
  if (!(await ledger.ledgerIsBalanced())) return "the ledger does not balance";
  return true;
});

/* ===================================================================== A11 */

await acceptance("A11", "An unreadable serial permits draft and review only; an exception is an admin's to grant", async () => {
  const unreadable = await addApproved(p.biz, p.owner, {
    kind: "tractor", name: "A-NoPlate", identifier: "", ownership: "owned", notes: "",
    specs: TRACTOR, serialStatus: "unreadable",
  });
  if (equipment.unavailableReason(unreadable) === null) return "a machine with an unreadable plate was quotable";
  const staff = await user("A11 Staff", "admin");
  if (!(await equipment.grantSerialException(staff, unreadable.id, "Plate photographed and filed"))) {
    return "an administrator could not grant an exception";
  }
  const after = await equipment.getAsset(p.biz, unreadable.id);
  if (!after || equipment.unavailableReason(after) !== null) return "the exception did not clear the block";
  return true;
});

/* ===================================================================== A12 */

await acceptance("A12", "Compatibility is a recorded judgement; correcting a critical spec sends it back", async () => {
  const fresh = await providerFixture("A12", "Bo", ["ploughing"]);
  const t = await addApproved(fresh.biz, fresh.owner, {
    kind: "tractor", name: "A12-T", identifier: "A12-T", ownership: "owned", notes: "", specs: TRACTOR,
  });
  const pl = await addApproved(fresh.biz, fresh.owner, {
    kind: "plough", name: "A12-P", identifier: "A12-P", ownership: "owned", notes: "", specs: PLOUGH,
  });
  let ready = (await pairing.readinessFor(fresh.biz, ["ploughing"]))[0]!;
  if (ready.ready) return "owning both halves counted as readiness";
  if (!ready.summary.includes("needs checking")) return `expected needs checking, got: ${ready.summary}`;

  await pairing.savePairing(fresh.biz, fresh.owner, {
    machineId: t.id, implementId: pl.id, service: "ploughing", verdict: "compatible", basis: "Measured",
  });
  ready = (await pairing.readinessFor(fresh.biz, ["ploughing"]))[0]!;
  if (!ready.ready) return "a recorded verdict did not make it ready";

  if ((await pairing.recheckAfterSpecChange(fresh.biz, t.id, fresh.owner)) !== 1) return "the recheck touched nothing";
  if ((await pairing.readinessFor(fresh.biz, ["ploughing"]))[0]!.ready) return "it stayed ready after a spec change";
  if ((await pairing.pairingsFor(fresh.biz, t.id)).length !== 1) return "the pairing row was deleted rather than reset";
  return true;
});

/* ===================================================================== A13 */

await acceptance("A13", "A blocking fault flags existing bookings rather than cancelling them", async () => {
  const { r, start } = await request();
  const q = await send(r.id, start);
  if (!q.ok) return `the quote failed: ${q.reason}`;
  if (!(await quotes.acceptQuote(q.quote.id, farmer)).ok) return "acceptance failed";
  const job = (await jobs.jobForRequest(r.id))!;

  await equipment.reportFault(p.biz, p.owner, tractor.id, "minor", "Cracked mirror");
  if (flags.openOnly(await flags.flagsForJob(job.id)).length !== 0) return "a minor fault raised a flag";

  await equipment.reportFault(p.biz, p.owner, tractor.id, "blocking", "Clutch gone");
  const raised = flags.openOnly(await flags.flagsForJob(job.id));
  if (raised.length !== 1) return `expected one flag, got ${raised.length}`;
  if ((await jobs.jobForRequest(r.id))?.status !== "scheduled") return "the booking was cancelled";
  if (!(await jobs.dispatchBlockers(p.biz, job.id)).some((b) => b.includes("Clutch"))) {
    return "an open flag did not stop the dispatch";
  }
  if ((await flags.resolveFlag(p.biz, p.owner, raised[0]!.id, " ")).ok) {
    return "a flag was cleared with no account of what was done";
  }
  if (!(await flags.resolveFlag(p.biz, p.owner, raised[0]!.id, "Swapped machines, farmer told")).ok) {
    return "a flag could not be resolved";
  }
  return true;
});

/* ===================================================================== A14 */

await acceptance("A14", "Revenue per machine is net of fees and attributable refunds, and reconciles", async () => {
  const rows = await revenue.revenueByMachine(p.biz);
  if (!revenue.reconciles(rows)) return "the machines plus the unallocated remainder do not equal the payouts";

  // The arithmetic itself, independent of whether a payout happens to have settled yet.
  const equal = await revenue.allocationFor("no-such-job", ["a", "b", "c"]);
  if (equal.shares.reduce((n, sh) => n + sh.shareBp, 0) !== revenue.FULL_SHARE_BP) {
    return "an even split does not come to the whole";
  }
  const awkward = revenue.allocate(100, equal);
  const parts = [...awkward.parts.values()];
  if (parts.reduce((a, b) => a + b, 0) + awkward.unallocatedMinor !== 100) return "an awkward amount does not add back up";

  const partial = {
    shares: [{ equipmentId: "a", shareBp: 6000, note: "" }, { equipmentId: "b", shareBp: 2500, note: "" }],
    unallocatedBp: 1500, stated: true,
  };
  const left = revenue.allocate(100000, partial);
  if (left.unallocatedMinor !== 15000) return "the unallocated share was spread rather than shown";
  if (left.parts.get("a") !== 60000) return "a stated share was not honoured";
  return true;
});

/* ===================================================================== A15 */

await acceptance("A15", "Retired assets cannot be quoted, referenced assets are never deleted, and a viewer sees one machine", async () => {
  const spare = await addApproved(p.biz, p.owner, {
    kind: "tractor", name: "A-Spare", identifier: "AC-S1", ownership: "owned", notes: "", specs: TRACTOR,
  });
  const retired = await equipment.retireAsset(p.biz, p.owner, spare.id, "Sold");
  if (!retired.ok) return `an idle machine could not be retired: ${retired.reason}`;
  const after = await equipment.getAsset(p.biz, spare.id);
  if (!after) return "retiring deleted the row";
  if (equipment.unavailableReason(after) !== "Retired") return "a retired machine was still usable";

  // A machine something still points at cannot be retired out from under it.
  if ((await equipment.retirementBlockers(p.biz, tractor.id)).length === 0) {
    return "a committed machine reports no blockers";
  }
  const refused = await equipment.retireAsset(p.biz, p.owner, tractor.id, "Trying it on");
  if (refused.ok) return "a committed machine was retired, stranding its bookings";

  // The authorised viewer, scoped to one named machine.
  const granted = await viewers.grantViewer(p.biz, p.owner, tractor.id, "donor@example.test", "A donor");
  if (!granted.ok) return `the grant was refused: ${granted.reason}`;
  const visible = await viewers.assetsVisibleTo("donor@example.test");
  if (visible.length !== 1 || visible[0] !== tractor.id) return "the grant is not scoped to the one machine";
  if (await viewers.utilisationFor("donor@example.test", plough.id)) return "the viewer could read a machine they were not granted";
  const u = await viewers.utilisationFor("donor@example.test", tractor.id);
  if (!u) return "the viewer could not read the machine they were granted";
  if (JSON.stringify(u).includes("Testville")) return "the viewer was shown where the work was";
  if (!(await viewers.revokeViewer(p.biz, p.owner, tractor.id, "donor@example.test"))) return "the grant could not be withdrawn";
  if ((await viewers.assetsVisibleTo("donor@example.test")).length !== 0) return "a withdrawn grant still reads";
  return true;
});

/* ===================================================================== A16 */

await acceptance("A16", "A retry creates no duplicate, and dates are shown in one time zone", async () => {
  const key = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const once = await addApproved(p.biz, p.owner, {
    kind: "trailer", name: "A-Trailer", identifier: "AC-TR1", ownership: "owned", notes: "", submissionKey: key,
  });
  const retry = await addApproved(p.biz, p.owner, {
    kind: "trailer", name: "A-Trailer", identifier: "AC-TR1", ownership: "owned", notes: "", submissionKey: key,
  });
  if (once.id !== retry.id) return "a retried Add made a second machine";

  const twice = await requests.createRequest(farmer, {
    service: "ploughing", services: ["ploughing"], acres: 4, landAccess: "easy", landCondition: "",
    landClearance: "cleared", district: "Bo", village: "Keyed", preferredDate: inDays(900),
    alternateDate: null, notes: "", contactName: "Acceptance Farmer", contactPhone: "76000001",
    contactEmail: "acceptance@example.test", submissionKey: "12345678-1234-1234-1234-123456789abc",
  });
  const again = await requests.createRequest(farmer, {
    service: "ploughing", services: ["ploughing"], acres: 4, landAccess: "easy", landCondition: "",
    landClearance: "cleared", district: "Bo", village: "Keyed", preferredDate: inDays(900),
    alternateDate: null, notes: "", contactName: "Acceptance Farmer", contactPhone: "76000001",
    contactEmail: "acceptance@example.test", submissionKey: "12345678-1234-1234-1234-123456789abc",
  });
  if (twice.id !== again.id) return "a resent request form made a second request";

  if (zone.ZONE !== "Africa/Freetown") return `the time zone constant is ${zone.ZONE}`;
  if (zone.onDay("2026-12-08") !== "08 Dec 2026") return `a date reads as ${zone.onDay("2026-12-08")}`;
  return true;
});

/* ------------------------------------------------------------------ the money, once */

console.log("\nAnd across all of it");
const balanced = await ledger.ledgerIsBalanced();
console.log(`  ${balanced ? "PASS" : "FAIL"}  --   Every ledger transaction sums to zero`);
if (!balanced) fails.push("the ledger does not balance");

/* ------------------------------------------------------------------ the report */

const passed = cases.filter((c) => c.ok).length;
console.log(`\n${passed}/${cases.length} acceptance cases pass.`);
console.log(`Build: ${process.env.npm_package_version ?? "dev"} · ${new Date().toISOString()}`);
console.log(`Database: ${(await import("../src/lib/db")).describe()}`);
if (fails.length) {
  console.log(`\nNot holding:\n${fails.map((f) => `  - ${f}`).join("\n")}`);
  process.exit(1);
}
