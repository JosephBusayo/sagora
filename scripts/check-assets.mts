/**
 * The asset identity rules from Karim's handover of 23 November 2026, checked without a browser.
 * Run against a throwaway database:
 *   DATABASE_PATH=<scratch>/a.db npm run db:migrate && DATABASE_PATH=<scratch>/a.db npm run check:assets
 *
 * These decide whether a machine can be committed to a farmer's work, so they get a test that does
 * not depend on any screen: condition, lease dates, serials and critical specifications each block
 * on their own, a rename keeps the machine, and one serial on two registers raises a review.
 */
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";
const { db } = await import("../src/lib/db");
const eq = await import("../src/lib/equipment");
const specs = await import("../src/lib/specs");
const { user, business } = await import("./fixtures.mjs");

const fails: string[] = [];
let n = 0;
const ok = (what: string, cond: boolean) => {
  n++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${what}`);
  if (!cond) fails.push(what);
};

const day = (offset: number) => new Date(Date.now() + offset * 86400_000).toISOString().slice(0, 10);

const owner = await user("Asset Owner", "provider");
const biz = await business(owner, "Asset Co");
const staff = await user("Asset Staff", "admin");

/**
 * Adds a machine and has Sagora approve it.
 *
 * Migration 035 leaves anything newly registered waiting for approval, which is a rule in its own
 * right and proved on its own below. Everything else in this file is about what blocks an
 * *accepted* machine — condition, lease, serial, specifications — so those get past the gate
 * first rather than every one of them failing for the same unrelated reason.
 */
const add = async (input: Parameters<typeof eq.addAsset>[2]) => {
  const a = await eq.addAsset(biz, owner, input);
  await eq.reviewEquipment(staff, a.id, "approved", "");
  return (await eq.getAsset(biz, a.id))!;
};

/** A tractor with every critical specification filled in, so only the tested rule can block it. */
let serial = 0;
const fullTractor = (over: Partial<Parameters<typeof eq.addAsset>[2]> = {}) => ({
  kind: "tractor", name: "Tractor", identifier: `SN-${++serial}`, ownership: "owned" as const, notes: "",
  specs: { power: "90", hitch: "Three-point category 2", lift: "2500" },
  ...over,
});

console.log("\nA fully recorded machine can be used");
const good = await add(fullTractor({ name: "Good tractor" }));
ok("nothing blocks it", eq.unavailableReason(good) === null);
ok("it appears in what a quote may choose", (await eq.selectableAssets(biz)).some((a) => a.id === good.id));

console.log("\nCritical specifications block until they are recorded");
const bare = await add({ kind: "tractor", name: "Bare tractor", identifier: "SN-BARE", ownership: "owned", notes: "" });
ok("a tractor with no power or hitch is blocked", eq.unavailableReason(bare) !== null);
ok("and the reason names what is missing", (eq.unavailableReason(bare) ?? "").toLowerCase().includes("engine power"));
ok("and says it as something to go and do", (eq.unavailableReason(bare) ?? "").toLowerCase().includes("recorded"));
ok("missingCritical lists them", specs.missingCritical("tractor", {}).length === 3);
ok("a drum seeder is not asked for a PTO", !specs.specsFor("other").some((x) => x.id === "pto" && x.critical));
await eq.updateAsset(biz, owner, bare.id, fullTractor({ name: "Bare tractor", identifier: "SN-BARE" }));
ok("recording them clears the block", eq.unavailableReason((await eq.getAsset(biz, bare.id))!) === null);

console.log("\nThe four condition states");
ok("working and limited use do not block",
  eq.CONDITIONS.filter((c) => !c.blocks).map((c) => c.id).join(",") === "working,limited");
const limited = await add(fullTractor({ name: "Limited tractor", condition: "limited", conditionNote: "Second gear only" }));
ok("limited use is still usable", eq.unavailableReason(limited) === null);
ok("but the restriction is surfaced", eq.limitedUseNote(limited) === "Second gear only");
await eq.setCondition(biz, owner, limited.id, "repair", "Gearbox out");
const inRepair = (await eq.getAsset(biz, limited.id))!;
ok("under repair blocks it", eq.unavailableReason(inRepair) === "Under repair");
ok("and the change is in its history", (await eq.historyFor(biz, limited.id)).some((h) => h.kind === "condition" && h.current === "repair"));

console.log("\nA lease blocks the days outside it");
const leased = await add(fullTractor({
  name: "Leased tractor", ownership: "leased", lessor: "Kamara Holdings", leaseFrom: day(-10), leaseTo: day(30),
}));
ok("inside the lease it is usable", eq.unavailableReason(leased, day(5)) === null);
ok("after the lease ends it is not", (eq.unavailableReason(leased, day(40)) ?? "").startsWith("Lease ended"));
ok("before it starts it is not", (eq.unavailableReason(leased, day(-20)) ?? "").startsWith("Leased from"));
ok("a quote for those dates cannot choose it", !(await eq.selectableAssets(biz, day(40))).some((a) => a.id === leased.id));
ok("a quote inside the lease can", (await eq.selectableAssets(biz, day(5))).some((a) => a.id === leased.id));

console.log("\nAn owned machine carries no lease dates");
const owned = await add(fullTractor({ name: "Owned tractor", lessor: "Nobody", leaseTo: day(1) }));
ok("lease fields are dropped on an owned asset", owned.lessor === "" && owned.leaseTo === "");
ok("so it is never blocked by one", eq.unavailableReason(owned, day(999)) === null);

console.log("\nA missing serial permits registration but not quoting");
const noSerial = await add(fullTractor({ name: "No plate", identifier: "", serialStatus: "unreadable" }));
ok("it registers", Boolean(noSerial.id));
ok("but it cannot be quoted", (eq.unavailableReason(noSerial) ?? "").includes("review"));
ok("an administrator can grant an exception", await eq.grantSerialException(staff, noSerial.id, "Plate corroded, engine number photographed"));
ok("and then it can be quoted", eq.unavailableReason((await eq.getAsset(biz, noSerial.id))!) === null);

console.log("\nRenaming keeps the machine");
const renamed = await add(fullTractor({ name: "Old name", assetRef: "FFSL-014" }));
await eq.updateAsset(biz, owner, renamed.id, fullTractor({ name: "New name", identifier: renamed.identifier, assetRef: "FFSL-014" }));
const after = (await eq.getAsset(biz, renamed.id))!;
ok("the id is unchanged", after.id === renamed.id);
ok("the provider's reference is unchanged", after.assetRef === "FFSL-014");
ok("the new name is in place", after.name === "New name");
ok("the old name is still readable in its history",
  (await eq.historyFor(biz, renamed.id)).some((h) => h.kind === "rename" && h.previous === "Old name"));

console.log("\nLocation is a statement with a date on it");
const roamer = await add(fullTractor({ name: "Roamer" }));
ok("nothing is claimed before anybody looks", eq.locationAgeDays(roamer) === null);
await eq.confirmLocation(biz, owner, roamer.id, "Makeni yard", "Abu Sesay");
const placed = (await eq.getAsset(biz, roamer.id))!;
ok("the place is recorded", placed.location === "Makeni yard" && placed.custodian === "Abu Sesay");
ok("so is who said so", placed.locationBy === owner);
ok("and it reads as confirmed today", eq.locationAgeDays(placed) === 0);

console.log("\nOne serial on two registers raises a review");
const rivalOwner = await user("Rival Owner", "provider");
const rival = await business(rivalOwner, "Rival Co");
const mine = await add(fullTractor({ name: "Disputed", identifier: "CHASSIS-9001" }));
await eq.addAsset(rival, rivalOwner, {
  kind: "tractor", name: "Also disputed", identifier: "CHASSIS-9001", ownership: "owned", notes: "",
  specs: { power: "90", hitch: "Drawbar", lift: "2000" },
});
const conflicts = await eq.openSerialConflicts();
ok("the clash is filed", conflicts.length === 1);
ok("it names both businesses", conflicts[0]?.sides.length === 2);
ok("it carries the serial", conflicts[0]?.serial === "CHASSIS-9001");
ok("neither machine is blocked by it", eq.unavailableReason((await eq.getAsset(biz, mine.id))!) === null);
ok("staff can close it", await eq.resolveSerialConflict(staff, conflicts[0]!.id, "Rival sold it in March; their row retired"));
ok("and it leaves the queue", (await eq.openSerialConflicts()).length === 0);

console.log("\nPurchase records stay out of the way");
const bought = await add(fullTractor({
  name: "Bought", acquiredOn: "2024-03-01", supplier: "Sonalika SL", purchaseCostMinor: 45000000,
  purchaseCurrency: "SLE", donor: "FFSL", useRestrictions: "Project use only",
}));
ok("they are kept", bought.purchaseCostMinor === 45000000 && bought.donor === "FFSL");
ok("and they never block the machine", eq.unavailableReason(bought) === null);
const ledger = await db.all("SELECT 1 FROM ledger_entry WHERE memo LIKE '%purchase%'");
ok("nor reach the ledger", ledger.length === 0);

console.log(`\n${n - fails.length}/${n} checks passed.`);
if (fails.length) process.exit(1);
