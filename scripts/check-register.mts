/**
 * The Equipment register's own rules, from Karim's handover of 23 November 2026. Run against a
 * throwaway database:
 *   DATABASE_PATH=<scratch>/r.db npm run db:migrate && DATABASE_PATH=<scratch>/r.db npm run check:register
 *
 *   "Equipment detail opens to four tabs: Overview, Schedule, Job history, Faults and repairs."
 *   "Show assignment activity for cancellations, replacements and expired holds, with no prices
 *    shown."
 *   "Move Record downtime and Record private work inside Equipment. Private work recorded outside
 *    the booking flow is a second source of scheduling truth."
 *   "Drafts and uploads must survive a dropped connection, and a retry must not create a
 *    duplicate."
 *
 * Most of this phase is screens, and a screen is not what these check. What they check is the two
 * things underneath that a screen cannot be trusted with: that downtime really blocks capacity
 * through the same path a quote goes through, and that a retried Add makes one machine. Plus the
 * one rule with a privacy edge — assignment activity must carry no prices.
 */
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";
const { db } = await import("../src/lib/db");
const equipment = await import("../src/lib/equipment");
const downtime = await import("../src/lib/downtime");
const detail = await import("../src/lib/asset-detail");
const holds = await import("../src/lib/holds");
const quotes = await import("../src/lib/quotes");
const jobs = await import("../src/lib/jobs");
const requests = await import("../src/lib/requests");
const { inDays, provider: providerFixture, quoteInput, user } = await import("./fixtures.mjs");

const fails: string[] = [];
let n = 0;
const ok = (what: string, cond: boolean) => {
  n++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${what}`);
  if (!cond) fails.push(what);
};

const p = await providerFixture("Register", "Bo", ["ploughing"]);
const reviewer = await user("Register Staff", "admin");
/** Adds a machine and approves it, which is what Sagora does before it may be used. */
const approved = async (input: Parameters<typeof equipment.addAsset>[2]) => {
  const a = await equipment.addAsset(p.biz, p.owner, input);
  await equipment.reviewEquipment(reviewer, a.id, "approved", "");
  return (await equipment.getAsset(p.biz, a.id))!;
};
const tractor = await approved({
  kind: "tractor", name: "Register tractor", identifier: "SN-REG-1", ownership: "owned", notes: "",
  specs: { power: "90", hitch: "Three-point category 2", lift: "2500" },
});
const plough = await approved({
  kind: "plough", name: "Register plough", identifier: "SN-REG-2", ownership: "owned", notes: "",
  specs: { powerNeeded: "70", hitch: "Three-point category 2" },
});

/* ------------------------------------------------- a retry is not a second machine */

console.log("\nA retried Add makes one machine, not two");
const key = "11111111-2222-3333-4444-555555555555";
const first = await equipment.addAsset(p.biz, p.owner, {
  kind: "tractor", name: "Retried tractor", identifier: "SN-RETRY", ownership: "owned", notes: "",
  specs: { power: "80", hitch: "Three-point category 2", lift: "2000" }, submissionKey: key,
});
const second = await equipment.addAsset(p.biz, p.owner, {
  kind: "tractor", name: "Retried tractor", identifier: "SN-RETRY", ownership: "owned", notes: "",
  specs: { power: "80", hitch: "Three-point category 2", lift: "2000" }, submissionKey: key,
});
ok("the second attempt returns the first machine", first.id === second.id);
ok("and only one is on the register",
  (await equipment.listAssets(p.biz)).filter((a) => a.identifier === "SN-RETRY").length === 1);

const other = await providerFixture("Rival Register", "Bo", ["ploughing"]);
const stolen = await equipment.addAsset(other.biz, other.owner, {
  kind: "tractor", name: "Theirs", identifier: "SN-THEIRS", ownership: "owned", notes: "",
  specs: { power: "80", hitch: "Three-point category 2", lift: "2000" }, submissionKey: key,
});
ok("another business reusing the key gets its own machine", stolen.id !== first.id);
ok("and cannot read the first one", stolen.name === "Theirs");

const noKey1 = await equipment.addAsset(p.biz, p.owner, {
  kind: "trailer", name: "Trailer", identifier: "SN-T1", ownership: "owned", notes: "",
});
const noKey2 = await equipment.addAsset(p.biz, p.owner, {
  kind: "trailer", name: "Trailer", identifier: "SN-T1", ownership: "owned", notes: "",
});
ok("two machines with the same name are still two machines", noKey1.id !== noKey2.id);
ok("a nonsense key is ignored rather than trusted",
  (await equipment.addAsset(p.biz, p.owner, {
    kind: "trailer", name: "Trailer two", identifier: "SN-T2", ownership: "owned", notes: "",
    submissionKey: "not-a-uuid",
  })).id !== noKey1.id);

/* ------------------------------------------------------------ downtime blocks */

console.log("\nBooking a machine out stops it being quoted");
ok("nothing is booked out to begin with", (await downtime.downtimeFor(p.biz, tractor.id)).length === 0);
const booked = await downtime.recordDowntime(p.biz, p.owner, {
  equipmentId: tractor.id, kind: "service", fromDate: inDays(30), toDate: inDays(32),
  reason: "250-hour service",
});
ok("it can be booked out", booked.ok);
ok("and shows on its own record", (await downtime.downtimeFor(p.biz, tractor.id)).length === 1);

ok("the capacity check sees it",
  (await holds.clashesFor([{ kind: "equipment", resourceId: tractor.id, label: "" }],
    { from: inDays(31), to: inDays(31) }, null, p.biz)).length === 1);
ok("and says what it is booked out for",
  (await holds.clashesFor([{ kind: "equipment", resourceId: tractor.id, label: "" }],
    { from: inDays(31), to: inDays(31) }, null, p.biz))[0]!.why.includes("planned servicing"));

const farmer = await user("Register Farmer");
const req = await requests.createRequest(farmer, {
  service: "ploughing", services: ["ploughing"], acres: 3, landAccess: "easy", landCondition: "",
  landClearance: "cleared", district: "Bo", village: "Testville", preferredDate: inDays(31),
  alternateDate: null, notes: "", contactName: "Register Farmer", contactPhone: "76000001",
  contactEmail: "reg@example.test", submissionKey: null,
});
const refused = await quotes.sendQuote(req.id, p.biz, p.owner, {
  ...quoteInput(p, inDays(31), { daysToComplete: 1, assetIds: [tractor.id, plough.id] }),
  capacityConfirmed: true,
});
ok("so a quote over those days is refused", !refused.ok);
ok("by name", !refused.ok && refused.reason.includes("Register tractor"));
ok("and the refusal offers the next free window",
  !refused.ok && refused.reason.includes("The earliest everything is free is"));

console.log("\nDowntime cannot be booked over work already promised");
const clear = await requests.createRequest(farmer, {
  service: "ploughing", services: ["ploughing"], acres: 3, landAccess: "easy", landCondition: "",
  landClearance: "cleared", district: "Bo", village: "Testville", preferredDate: inDays(60),
  alternateDate: null, notes: "", contactName: "Register Farmer", contactPhone: "76000001",
  contactEmail: "reg@example.test", submissionKey: null,
});
const sent = await quotes.sendQuote(clear.id, p.biz, p.owner, {
  ...quoteInput(p, inDays(60), { daysToComplete: 1, assetIds: [tractor.id, plough.id] }),
  capacityConfirmed: true,
});
ok("a quote on free days goes out", sent.ok);
const overWork = await downtime.recordDowntime(p.biz, p.owner, {
  equipmentId: tractor.id, kind: "repair", fromDate: inDays(60), toDate: inDays(60), reason: "",
});
ok("downtime over promised work is refused", !overWork.ok);
ok("and says to move the work first",
  !overWork.ok && overWork.reason.includes("Move that work"));

console.log("\nCalling downtime off frees the machine");
const live = (await downtime.downtimeFor(p.biz, tractor.id)).find((d) => d.cancelledAt === "")!;
ok("it can be called off", await downtime.cancelDowntime(p.biz, p.owner, live.id));
ok("the machine is free again",
  (await holds.clashesFor([{ kind: "equipment", resourceId: tractor.id, label: "" }],
    { from: inDays(31), to: inDays(31) }, null, p.biz)).length === 0);
ok("but the record survives, because availability history is evidence",
  (await downtime.downtimeFor(p.biz, tractor.id)).length === 1);
ok("another business cannot book out this machine",
  !(await downtime.recordDowntime(other.biz, other.owner, {
    equipmentId: tractor.id, kind: "service", fromDate: inDays(90), toDate: inDays(90), reason: "",
  })).ok);
ok("an end date before the start is refused",
  !(await downtime.recordDowntime(p.biz, p.owner, {
    equipmentId: tractor.id, kind: "service", fromDate: inDays(95), toDate: inDays(90), reason: "",
  })).ok);

/* --------------------------------------------------------------- the four tabs */

console.log("\nThe detail window's three other tabs");
const d = await detail.detailFor(p.biz, tractor.id);
ok("Schedule shows the quote's hold", d.schedule.some((c) => c.kind === "hold"));
ok("and marks it as not firm yet, because the farmer has not answered",
  d.schedule.some((c) => c.kind === "hold" && !c.committed));
ok("Job history is empty until work is finished", d.history.length === 0);
ok("Faults and repairs is empty until one is reported", d.faults.length === 0);

await quotes.acceptQuote(sent.ok ? sent.quote.id : "", farmer);
const after = await detail.detailFor(p.biz, tractor.id);
ok("once accepted, the same commitment reads as firm",
  after.schedule.some((c) => c.committed && c.what.includes(clear.reference)));
ok("and it is listed once, not twice",
  after.schedule.filter((c) => c.what.includes(clear.reference)).length === 1);

console.log("\nFaults and repairs keeps everything, resolved or not");
await equipment.reportFault(p.biz, p.owner, tractor.id, "minor", "Cracked mirror");
const faults = (await detail.detailFor(p.biz, tractor.id)).faults;
ok("a reported fault appears", faults.length === 1);
ok("marked open", faults[0]?.resolvedAt === null);
const faultId = faults[0]!.id;
ok("it can be resolved", await equipment.resolveFault(p.biz, p.owner, faultId, "New mirror fitted"));
const kept = (await detail.detailFor(p.biz, tractor.id)).faults;
ok("and is kept rather than deleted", kept.length === 1 && kept[0]?.resolvedAt !== null);
ok("with what was done about it", kept[0]?.resolution === "New mirror fitted");

/* -------------------------------------------------- assignment activity, no prices */

console.log("\nAssignment activity, with no prices shown");
const activity = await detail.assignmentActivityFor(p.biz, tractor.id);
ok("reserving the machine is recorded", activity.some((x) => x.text.includes("Reserved for")));
ok("so is committing it as a booking", activity.some((x) => x.text.includes("as a booking")));
ok("so is being booked out", activity.some((x) => x.text.includes("Booked out")));
ok("and calling that off", activity.some((x) => x.text.includes("called off")));
// The one rule here with an edge: this window is open to anyone with view_jobs, which is what a
// driver gets. A figure in Leones has no business being in it.
const money = /\d[\d,]*\.\d{2}|Le\s*\d|SLE\s*\d/;
ok("not one line carries a price", !activity.some((x) => money.test(x.text)));
ok("nor does the schedule", !after.schedule.some((c) => money.test(c.what)));
ok("nor the job history", !after.history.some((j) => money.test(j.what)));

console.log("\nOne machine's record is not another's");
ok("a business sees nothing of another's machine",
  (await detail.detailFor(other.biz, tractor.id)).schedule.length === 0);
ok("nor its faults", (await detail.detailFor(other.biz, tractor.id)).faults.length === 0);
ok("nor its activity", (await detail.assignmentActivityFor(other.biz, tractor.id)).length === 0);

console.log("\nPrivate work goes through the same scheduling truth");
// Creating it makes the request and an unscheduled job; scheduling it is the step that commits the
// machine — which is the point of the handover's complaint. Private work goes through exactly the
// path a farmer's job does, so it cannot become a second source of scheduling truth.
const privateJob = await jobs.createPrivateJob(p.biz, p.owner, {
  customerName: "My own farm", customerPhone: "76000009", service: "ploughing", acres: 2,
  district: "Bo", village: "Testville", notes: "",
});
ok("it makes a job", Boolean(privateJob));
const scheduled = await jobs.scheduleJob(p.biz, p.owner, privateJob, {
  startDate: inDays(120), endDate: inDays(121), operatorId: p.operator,
  assetIds: [tractor.id, plough.id],
});
ok("which schedules like any other", scheduled.ok);
ok("and blocks the capacity check like any other job",
  (await holds.clashesFor([{ kind: "equipment", resourceId: tractor.id, label: "" }],
    { from: inDays(120), to: inDays(120) }, null, p.biz)).length === 1);
ok("and shows on the machine's schedule",
  (await detail.scheduleFor(p.biz, tractor.id)).some((c) => c.what.includes("My own farm")));

/* ------------------------------------------- Sagora has to see a machine before it works */

console.log("\nNewly registered equipment waits for Sagora");
const fresh = await equipment.addAsset(p.biz, p.owner, {
  kind: "tractor", name: "Brand new tractor", identifier: "SN-REG-NEW", ownership: "owned", notes: "",
  specs: { power: "95", hitch: "Three-point category 2", lift: "2600" },
});
ok("it saves", Boolean(fresh.id));
ok("and it is on the provider's own register", (await equipment.listAssets(p.biz)).some((a) => a.id === fresh.id));
ok("but it is waiting for approval", fresh.review === "pending");
ok("so it cannot be used", (equipment.unavailableReason(fresh) ?? "").includes("approve"));
ok("and a quote cannot choose it", !(await equipment.selectableAssets(p.biz)).some((a) => a.id === fresh.id));
const queue = await equipment.equipmentAwaitingReview();
ok("it is in the queue staff read", queue.some((r) => r.equipmentId === fresh.id));
ok("the queue names the provider, not just the machine",
  queue.some((r) => r.equipmentId === fresh.id && r.businessName.length > 0));
ok("and says what kind of machine it is", queue.some((r) => r.equipmentId === fresh.id && r.kindLabel === "Tractor"));

console.log("\nA rejection has to say why, and the provider can answer it");
ok("rejecting with no reason is refused", !(await equipment.reviewEquipment(reviewer, fresh.id, "rejected", "")).ok);
ok("rejecting with one is accepted",
  (await equipment.reviewEquipment(reviewer, fresh.id, "rejected", "The serial in the photo does not match the one typed in")).ok);
const rejected = (await equipment.getAsset(p.biz, fresh.id))!;
ok("the provider sees the reason", rejected.reviewNote.includes("does not match"));
ok("and it still cannot be used", (equipment.unavailableReason(rejected) ?? "").includes("Not approved"));
await equipment.updateAsset(p.biz, p.owner, fresh.id, {
  kind: "tractor", name: "Brand new tractor", identifier: "SN-REG-NEW-FIXED", ownership: "owned", notes: "",
  specs: { power: "95", hitch: "Three-point category 2", lift: "2600" },
});
const corrected = (await equipment.getAsset(p.biz, fresh.id))!;
ok("correcting it sends it back for review", corrected.review === "pending");
ok("and clears the old reason", corrected.reviewNote === "");

console.log("\nApproval is what lets it work");
ok("approving needs no note", (await equipment.reviewEquipment(reviewer, fresh.id, "approved", "")).ok);
const liveAsset = (await equipment.getAsset(p.biz, fresh.id))!;
ok("it is approved", liveAsset.review === "approved");
ok("nothing blocks it now", equipment.unavailableReason(liveAsset) === null);
ok("and a quote may choose it", (await equipment.selectableAssets(p.biz)).some((a) => a.id === liveAsset.id));
ok("who decided is recorded", liveAsset.reviewedBy === reviewer && liveAsset.reviewedAt.length > 0);
ok("an approved machine is not disturbed by an ordinary edit", await (async () => {
  await equipment.updateAsset(p.biz, p.owner, fresh.id, {
    kind: "tractor", name: "Renamed tractor", identifier: "SN-REG-NEW-FIXED", ownership: "owned", notes: "",
    specs: { power: "95", hitch: "Three-point category 2", lift: "2600" },
  });
  return (await equipment.getAsset(p.biz, fresh.id))!.review === "approved";
})());

console.log("\nNothing here touched the money");
ok("the ledger was never involved", (await db.all("SELECT 1 FROM ledger_entry")).length === 0);

console.log(`\n${n - fails.length}/${n} checks passed.`);
if (fails.length) process.exit(1);
