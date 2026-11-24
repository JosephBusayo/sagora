/**
 * Credible capacity, from Karim's handover of 23 November 2026. Run against a throwaway database:
 *   DATABASE_PATH=<scratch>/p.db npm run db:migrate && DATABASE_PATH=<scratch>/p.db npm run check:packages
 *
 * Six rules, all about the same thing: a reservation that tells the truth.
 *
 *   "For a package such as ploughing and harrowing, plan each operation and reserve its resources
 *    for its own window. All stages must be covered before the package is quoted."
 *   "Account for travel and set-up time so the days either side of the work are not offered as free."
 *   "Each case blocks Send quotation with a specific reason… show the next available window."
 *   "Require confirmation of machine condition and outside commitments at quotation, and recheck
 *    before dispatch. Capacity that has gone stale stays blocked until it is confirmed again."
 *   "A new blocking fault must flag existing bookings for action rather than cancelling them
 *    silently."
 *   "A shared asset shares its reservation constraint without sharing business data."
 *
 * The last one is the only place in Sagora where one business's data could reach another, so the
 * redaction has its own checks rather than being taken on trust.
 */
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";
const { db } = await import("../src/lib/db");
const requests = await import("../src/lib/requests");
const quotes = await import("../src/lib/quotes");
const jobs = await import("../src/lib/jobs");
const holds = await import("../src/lib/holds");
const ops = await import("../src/lib/operations");
const equipment = await import("../src/lib/equipment");
const shares = await import("../src/lib/shares");
const flags = await import("../src/lib/flags");
const cat = await import("../src/lib/catalogue");
const { setSetting } = await import("../src/lib/follow-ups");
const { inDays, provider: providerFixture, quoteInput, user } = await import("./fixtures.mjs");

const fails: string[] = [];
let n = 0;
const ok = (what: string, cond: boolean) => {
  n++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${what}`);
  if (!cond) fails.push(what);
};

const ALL = ["ploughing", "harrowing", "planting"];
// Harrowing is inactive in the live catalogue, so a package needs it switched on to be asked for.
// Done here rather than in the catalogue, because what Sagora sells is Karim's decision.
const live = new Set(["ploughing", "harvesting", "planting"]);
const activate = (id: string) => {
  const s = cat.SERVICES.find((x) => x.id === id);
  if (s) (s as { active: boolean }).active = true;
};
for (const id of ALL) if (!live.has(id)) activate(id);

const farmer = await user("Package Farmer");
const make = (services: string[], over: Partial<{ preferredDate: string; district: string }> = {}) =>
  requests.createRequest(farmer, {
    service: services[0]!, services, acres: 4, landAccess: "easy", landCondition: "",
    landClearance: "cleared", district: over.district ?? "Bo", village: "Testville",
    preferredDate: over.preferredDate ?? inDays(20), alternateDate: null, notes: "",
    contactName: "Package Farmer", contactPhone: "76000001", contactEmail: "pkg@example.test",
    submissionKey: null,
  });

/* ------------------------------------------------- every request is a list of operations */

console.log("\nEvery request is a list of stages, and most are lists of one");
const plain = await make(["ploughing"]);
const plainOps = await ops.operationsFor(plain.id);
ok("a single-service request has one stage", plainOps.length === 1);
ok("and it is the service that was asked for", plainOps[0]?.service === "ploughing");
ok("service_request.service still says ploughing", plain.service === "ploughing");
ok("which is not a package", !ops.isPackage(plainOps));

const pack = await make(["planting", "ploughing", "harrowing"]);
const packOps = await ops.operationsFor(pack.id);
ok("a package keeps every stage", packOps.length === 3);
ok("in the order the work has to happen, not the order they were ticked",
  packOps.map((o) => o.service).join(",") === "ploughing,harrowing,planting");
ok("the request leads with the first stage", pack.service === "ploughing");
ok("and reads as a sequence", ops.describeOperations(packOps) === "Ploughing, harrowing, then planting");

console.log("\nWhat a farmer may ask for");
ok("nothing at all is refused", ops.packageProblem([]) !== null);
ok("the same service twice is refused", Boolean(ops.packageProblem(["ploughing", "ploughing"])?.includes("twice")));
ok("a service Sagora does not sell is refused by name",
  Boolean(ops.packageProblem(["ploughing", "baling"])?.includes("Straw or hay baling")));
ok("five stages is a season's plan, not a job",
  Boolean(ops.packageProblem(["deep_loosening", "ploughing", "harrowing", "planting", "spraying"])?.includes("up to 4")));

/* --------------------------------------------------- all stages must be covered */

console.log("\nAll stages must be covered before the package is quoted");
const partial = await providerFixture("Partial", "Bo", ["ploughing"]);
const whole = await providerFixture("Whole", "Bo", ALL);
const seen = await requests.browse({}, 1, { id: partial.biz, district: "Bo", services: ["ploughing"] });
ok("a provider who only ploughs does not see the package",
  !seen.rows.some((r) => r.id === pack.id));
ok("but still sees the plain ploughing request", seen.rows.some((r) => r.id === plain.id));
const seenAll = await requests.browse({}, 1, { id: whole.biz, district: "Bo", services: ALL });
ok("a provider who covers every stage sees it", seenAll.rows.some((r) => r.id === pack.id));
ok("the count agrees with the rows, so the pages are not ragged",
  seenAll.total >= seen.total + 1);

const told = await requests.providersCovering({ district: "Bo", service: "ploughing", services: ALL });
ok("only the provider who covers every stage is told about it",
  told.some((t) => t.businessId === whole.biz) && !told.some((t) => t.businessId === partial.biz));
ok("a plain request still reaches both",
  (await requests.providersCovering({ district: "Bo", service: "ploughing" })).length >= 2);

ok("coversEveryStage is false when one is missing", !ops.coversEveryStage(["ploughing"], packOps));
ok("and names the stages that are not covered",
  ops.stagesNotCovered(["ploughing"], packOps).map((o) => o.service).join(",") === "harrowing,planting");

/* ------------------------------------------- each stage reserved for its own window */

console.log("\nEach stage is planned and reserved for its own window");
await setSetting(whole.owner, "travel_setup_days", "0"); // travel gets its own section below
const plan = packOps.map((o, i) => ({
  operationId: o.id, service: o.service, sequence: o.sequence,
  startDate: inDays(20 + i * 5), daysToComplete: 2, dailyRateMinor: 50000, amountMinor: 100000,
}));
const sent = await quotes.sendQuote(pack.id, whole.biz, whole.owner,
  { ...quoteInput(whole, inDays(20)), plan, capacityConfirmed: true });
ok("the package is quoted", sent.ok);
const quote = sent.ok ? sent.quote : null;
ok("the quote carries a plan per stage", quote?.plan.length === 3);
ok("the total is the stages added up", quote?.amountMinor === 300000);
ok("the quote starts on the first stage", quote?.startDate === inDays(20));

const placed = quote ? await holds.forQuote(quote.id) : [];
ok("two resources held per stage, six in all", placed.length === 6);
ok("each hold knows which stage it is for",
  new Set(placed.map((h) => h.operationId)).size === 3);
ok("the windows are the stages' own, not one long block",
  new Set(placed.map((h) => h.startDate)).size === 3);
ok("the first stage holds the days it works",
  placed.some((h) => h.startDate === inDays(20) && h.endDate === inDays(21)));

console.log("\nA plan has to cover the request, in a workable order");
const short = await quotes.sendQuote(pack.id, whole.biz, whole.owner, {
  ...quoteInput(whole, inDays(20)), capacityConfirmed: true,
  plan: plan.slice(0, 2),
});
ok("a plan missing a stage is refused", !short.ok);
ok("and names the stage with no dates", !short.ok && short.reason.includes("Planting"));

const backwards = await quotes.sendQuote(pack.id, whole.biz, whole.owner, {
  ...quoteInput(whole, inDays(20)), capacityConfirmed: true,
  plan: [
    { ...plan[0]!, startDate: inDays(40) }, // ploughing last
    plan[1]!, plan[2]!,
  ],
});
ok("harrowing before ploughing is refused", !backwards.ok);
ok("and says which stage cannot come first",
  !backwards.ok && backwards.reason.toLowerCase().includes("ploughing is finished"));

console.log("\nOne acceptance, one booking, every stage");
const accepted = quote ? await quotes.acceptQuote(quote.id, farmer) : { ok: false as const, reason: "no quote" };
ok("the farmer accepts the whole package at once", accepted.ok);
const job = await jobs.jobForRequest(pack.id);
ok("one booking, not three", Boolean(job));
ok("running from the first stage to the last",
  job?.startDate === inDays(20) && job?.endDate === inDays(31));
ok("every hold became the booking's own commitment",
  quote ? (await holds.forQuote(quote.id)).every((h) => h.status === "converted") : false);

/* ------------------------------------------------------- travel and set-up */

console.log("\nTravel and set-up block the days either side");
ok("the default is a day", holds.DEFAULT_TRAVEL_DAYS === 1);
await setSetting(whole.owner, "travel_setup_days", "1");
ok("the setting is read back", (await holds.travelDays()) === 1);
const w = holds.blockWindow(inDays(10), inDays(11), 1);
ok("one day either side", w.from === inDays(9) && w.to === inDays(12));
await setSetting(whole.owner, "travel_setup_days", "nonsense");
ok("a nonsense setting falls back to the default", (await holds.travelDays()) === holds.DEFAULT_TRAVEL_DAYS);

const travelFarmer = await user("Travel Farmer");
const mkFor = (who: string, services: string[], start: string) =>
  requests.createRequest(who, {
    service: services[0]!, services, acres: 2, landAccess: "easy", landCondition: "",
    landClearance: "cleared", district: "Bo", village: "Testville", preferredDate: start,
    alternateDate: null, notes: "", contactName: "Travel Farmer", contactPhone: "76000001",
    contactEmail: "travel@example.test", submissionKey: null,
  });
const tA = await mkFor(travelFarmer, ["ploughing"], inDays(60));
const tB = await mkFor(travelFarmer, ["ploughing"], inDays(62));
const first = await quotes.sendQuote(tA.id, partial.biz, partial.owner,
  { ...quoteInput(partial, inDays(60), { daysToComplete: 1 }), capacityConfirmed: true });
ok("the first job is quoted", first.ok);
const touching = await quotes.sendQuote(tB.id, partial.biz, partial.owner,
  { ...quoteInput(partial, inDays(62), { daysToComplete: 1 }), capacityConfirmed: true });
ok("the day after next is refused: the machine is still travelling", !touching.ok);
ok("and the refusal says what is in the way",
  !touching.ok && touching.reason.includes("Tractor Partial"));

console.log("\nA refusal names the next window that would work");
ok("the refusal offers a date", !touching.ok && touching.reason.includes("The earliest everything is free is"));
const free = await holds.nextFreeWindow(
  [{ kind: "equipment", resourceId: partial.machine, label: "" }], 1, inDays(60), partial.biz, 1);
ok("which is past the travel on the far side", free !== null && free.from >= inDays(63));
ok("and a suggested window actually passes the real check", free
  ? (await holds.clashesFor([{ kind: "equipment", resourceId: partial.machine, label: "" }],
      holds.blockWindow(free.from, free.to, 1), null, partial.biz)).length === 0
  : false);

/* ---------------------------------------------- capacity has to be confirmed */

console.log("\nCapacity has to be confirmed, and the confirmation goes stale");
const unconfirmedReq = await mkFor(travelFarmer, ["ploughing"], inDays(80));
const unconfirmed = await quotes.sendQuote(unconfirmedReq.id, partial.biz, partial.owner,
  { ...quoteInput(partial, inDays(80)), capacityConfirmed: false });
ok("a quote without the confirmation is refused", !unconfirmed.ok);
ok("and says what to confirm",
  !unconfirmed.ok && unconfirmed.reason.includes("working order"));

const confirmedReq = await mkFor(travelFarmer, ["ploughing"], inDays(82));
const withOutside = await quotes.sendQuote(confirmedReq.id, partial.biz, partial.owner, {
  ...quoteInput(partial, inDays(82)), capacityConfirmed: true,
  outsideCommitments: "Two days on my own farm the week before",
});
ok("a confirmed quote goes out", withOutside.ok);
ok("what they declared is kept",
  withOutside.ok && withOutside.quote.outsideCommitments.includes("own farm"));
ok("with the moment they said it", withOutside.ok && withOutside.quote.capacityConfirmedAt !== "");
ok("a fresh confirmation is not stale",
  withOutside.ok && !quotes.capacityStale(withOutside.quote));
ok("a day-old one is",
  quotes.capacityStale({ capacityConfirmedAt: new Date(Date.now() - 25 * 3600_000).toISOString(), createdAt: "" }));
ok("one with no statement at all is stale", quotes.capacityStale({ capacityConfirmedAt: "", createdAt: "" }));

console.log("\nStale capacity blocks the dispatch, not the acceptance");
const dispatchReq = await mkFor(travelFarmer, ["ploughing"], inDays(90));
const dq = await quotes.sendQuote(dispatchReq.id, partial.biz, partial.owner,
  { ...quoteInput(partial, inDays(90)), capacityConfirmed: true });
ok("the quote is sent", dq.ok);
if (dq.ok) {
  ok("and can be accepted", (await quotes.acceptQuote(dq.quote.id, travelFarmer)).ok);
  await db.run("UPDATE quote SET capacity_confirmed_at=? WHERE id=?",
    new Date(Date.now() - 10 * 86400_000).toISOString(), dq.quote.id);
  const dj = (await jobs.jobForRequest(dispatchReq.id))!;
  const stopped = await jobs.dispatchBlockers(partial.biz, dj.id);
  ok("a week-old assurance stops the machine at the gate",
    stopped.some((x) => x.includes("gone stale")));
  const refused = await jobs.markMobilised(partial.biz, partial.owner, dj.id);
  ok("so the dispatch is refused", !refused.ok);
  ok("confirming again clears it", await jobs.reconfirmCapacity(partial.biz, partial.owner, dj.id));
  ok("and the blocker is gone",
    !(await jobs.dispatchBlockers(partial.biz, dj.id)).some((x) => x.includes("gone stale")));
}

/* --------------------------------------- a fault flags work, it does not cancel it */

console.log("\nA blocking fault flags the bookings rather than cancelling them");
const faultJob = (await jobs.jobForRequest(dispatchReq.id))!;
ok("nothing is flagged yet", (await flags.flagsForJob(faultJob.id)).length === 0);
ok("a minor fault flags nothing",
  (await equipment.reportFault(partial.biz, partial.owner, partial.machine, "minor", "Cracked mirror")) &&
  flags.openOnly(await flags.flagsForJob(faultJob.id)).length === 0);
await equipment.reportFault(partial.biz, partial.owner, partial.machine, "blocking", "Clutch has gone");
const raised = flags.openOnly(await flags.flagsForJob(faultJob.id));
ok("a blocking one flags the booking", raised.length === 1);
ok("naming the machine and the fault",
  Boolean(raised[0]?.reason.includes("Tractor Partial") && raised[0]?.reason.includes("Clutch")));
ok("the booking is still there", (await jobs.jobForRequest(dispatchReq.id))?.status === "scheduled");
await equipment.reportFault(partial.biz, partial.owner, partial.machine, "blocking", "Clutch again");
ok("reporting the same kind of problem twice is one flag",
  flags.openOnly(await flags.flagsForJob(faultJob.id)).length === 1);
ok("it shows in the provider's queue",
  (await flags.openFlagsFor(partial.biz)).some((f) => f.jobId === faultJob.id));
ok("and in staff's, across every provider",
  (await flags.allOpenFlags()).some((f) => f.jobId === faultJob.id));
ok("an open flag stops the dispatch",
  (await jobs.dispatchBlockers(partial.biz, faultJob.id)).some((x) => x.includes("Clutch")));
ok("resolving it with no account of what was done is refused",
  !(await flags.resolveFlag(partial.biz, partial.owner, raised[0]!.id, " ")).ok);
ok("resolving it properly works",
  (await flags.resolveFlag(partial.biz, partial.owner, raised[0]!.id, "Swapped to Tractor B")).ok);
ok("and the flag is kept, not deleted",
  (await flags.flagsForJob(faultJob.id)).some((f) => f.id === raised[0]!.id && f.resolution.includes("Swapped")));
ok("moving a machine into repair flags the same way",
  (await equipment.setCondition(partial.biz, partial.owner, partial.machine, "repair", "Clutch")) &&
  flags.openOnly(await flags.flagsForJob(faultJob.id)).some((f) => f.cause === "condition"));

/* ------------------------------- one machine, two providers, no shared customers */

console.log("\nA shared machine shares its dates and nothing else");
const owner = await providerFixture("Owner", "Bo", ALL);
const borrower = await providerFixture("Borrower", "Bo", ALL);
ok("a machine cannot be shared with its own owner",
  !(await shares.grantShare(owner.biz, owner.owner, owner.machine, owner.biz, "")).ok);
ok("nor by somebody who does not own it",
  !(await shares.grantShare(borrower.biz, borrower.owner, owner.machine, owner.biz, "")).ok);
ok("the owner can lend it",
  (await shares.grantShare(owner.biz, owner.owner, owner.machine, borrower.biz, "Weekends")).ok);

ok("the borrower can now put it on a quote",
  (await shares.usableAssets(borrower.biz)).some((a) => a.id === owner.machine && a.borrowed));
ok("and is told whose it is",
  (await shares.getUsableAsset(borrower.biz, owner.machine))?.ownerName === "Business Owner");
ok("but it is not on their register",
  !(await equipment.listAssets(borrower.biz)).some((a) => a.id === owner.machine));
ok("so they cannot retire it",
  !(await equipment.retireAsset(borrower.biz, borrower.owner, owner.machine, "Not mine")));
ok("nor fault it",
  !(await equipment.reportFault(borrower.biz, borrower.owner, owner.machine, "blocking", "Not mine")));

const sharedFarmer = await user("Shared Farmer");
const ownerReq = await requests.createRequest(sharedFarmer, {
  service: "ploughing", services: ["ploughing"], acres: 2, landAccess: "easy", landCondition: "",
  landClearance: "cleared", district: "Bo", village: "Testville", preferredDate: inDays(100),
  alternateDate: null, notes: "", contactName: "Shared Farmer", contactPhone: "76000001",
  contactEmail: "shared@example.test", submissionKey: null,
});
const ownerQuote = await quotes.sendQuote(ownerReq.id, owner.biz, owner.owner,
  { ...quoteInput(owner, inDays(100), { daysToComplete: 1 }), capacityConfirmed: true });
ok("the owner reserves it first", ownerQuote.ok);

const clash = await holds.clashesFor(
  [{ kind: "equipment", resourceId: owner.machine, label: "" }],
  holds.blockWindow(inDays(100), inDays(100), 1), null, borrower.biz);
ok("the borrower finds it taken", clash.length === 1);
// The dates are printed the way every other date in Sagora is — "08 Dec 2026", not "2026-12-08" —
// so this looks for that form. A borrower needs the dates to plan around; it is the reference, the
// farmer and the service they must not be told.
const asDay = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB",
    { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
ok("and is given the dates, which they need to plan around",
  Boolean(clash[0]?.why.includes(asDay(inDays(99))) || clash[0]?.why.includes(asDay(inDays(100)))));
ok("but not the reference, the farmer or the service",
  !clash[0]!.why.includes(ownerReq.reference) && !clash[0]!.why.toLowerCase().includes("ploughing"));
ok("and the clash is marked as somebody else's", clash[0]?.elsewhere === true);

const ownClash = await holds.clashesFor(
  [{ kind: "equipment", resourceId: owner.machine, label: "" }],
  holds.blockWindow(inDays(100), inDays(100), 1), null, owner.biz);
ok("the owner, looking at their own machine, is told which request",
  Boolean(ownClash[0]?.why.includes(ownerReq.reference)));
ok("and it is not marked as elsewhere", ownClash[0]?.elsewhere === false);

console.log("\nTaking a shared machine back");
const borrowReq = await requests.createRequest(sharedFarmer, {
  service: "ploughing", services: ["ploughing"], acres: 2, landAccess: "easy", landCondition: "",
  landClearance: "cleared", district: "Bo", village: "Testville", preferredDate: inDays(110),
  alternateDate: null, notes: "", contactName: "Shared Farmer", contactPhone: "76000001",
  contactEmail: "shared@example.test", submissionKey: null,
});
const borrowed = await quotes.sendQuote(borrowReq.id, borrower.biz, borrower.owner, {
  ...quoteInput(borrower, inDays(110), { daysToComplete: 1, assetIds: [owner.machine] }),
  capacityConfirmed: true,
});
ok("the borrower can quote the borrowed machine", borrowed.ok);
ok("the owner can take it back",
  await shares.revokeShare(owner.biz, owner.owner, owner.machine, borrower.biz));
ok("the borrower's live hold goes at once",
  borrowed.ok ? (await holds.forQuote(borrowed.quote.id)).every((h) => h.resourceId !== owner.machine || h.status === "released") : false);
ok("and they cannot reserve it again",
  !(await shares.getUsableAsset(borrower.biz, owner.machine)));
ok("the owner's own work was not touched",
  ownerQuote.ok ? (await holds.forQuote(ownerQuote.quote.id)).some((h) => h.status === "held") : false);

console.log("\nNothing here touched the money");
ok("the ledger was never involved", (await db.all("SELECT 1 FROM ledger_entry")).length === 0);

console.log(`\n${n - fails.length}/${n} checks passed.`);
if (fails.length) process.exit(1);
