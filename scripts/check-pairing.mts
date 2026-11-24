/**
 * Compatibility and readiness, from Karim's handover of 23 November 2026. Run against a throwaway
 * database:
 *   DATABASE_PATH=<scratch>/p.db npm run db:migrate && DATABASE_PATH=<scratch>/p.db npm run check:pairing
 *
 * The rule being checked is that a type match is not an engineering approval: owning a tractor and
 * owning a plough does not mean this plough goes behind this tractor, and until somebody says it
 * does, the service is not ready.
 */
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";
const { db } = await import("../src/lib/db");
const eq = await import("../src/lib/equipment");
const cat = await import("../src/lib/catalogue");
const pairing = await import("../src/lib/pairing");
const { setSetting } = await import("../src/lib/follow-ups");
const { user, business } = await import("./fixtures.mjs");

const fails: string[] = [];
let n = 0;
const ok = (what: string, cond: boolean) => {
  n++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${what}`);
  if (!cond) fails.push(what);
};

const owner = await user("Pairing Owner", "provider");
const biz = await business(owner, "Pairing Co");
const staff = await user("Pairing Staff", "admin");

let sn = 0;
const add = (kind: string, name: string, specs: Record<string, string>) =>
  eq.addAsset(biz, owner, { kind, name, identifier: `P-${++sn}`, ownership: "owned" as const, notes: "", specs });

const TRACTOR = { power: "90", hitch: "Three-point category 2", lift: "2500" };
const PLOUGH = { powerNeeded: "70", hitch: "Three-point category 2" };

console.log("\nThe catalogue carries all twenty services, and offers only the live ones");
ok("twenty-three services in the catalogue", cat.SERVICES.length === 23);
ok("three are active", cat.activeServices().length === 3);
ok("the three are the ones Sagora already sold",
  cat.activeServices().map((s) => s.id).join(",") === "ploughing,harvesting,planting");
ok("harrowing is described but not offered", cat.isService("harrowing") && !cat.isActiveService("harrowing"));
ok("a self-contained combine needs no tractor", cat.isSelfContainedFor("combine_harvesting", "combine"));
ok("a drum seeder is independent equipment", cat.isSelfContainedFor("rice_direct_seeding", "rice_seeder"));
ok("a plough is not a power unit", !cat.isPowerUnit("plough"));

console.log("\nOwning the right types is not the same as being ready");
const tractor = await add("tractor", "Tractor A", TRACTOR);
let ready = (await pairing.readinessFor(biz, ["ploughing"]))[0]!;
ok("a tractor alone is not ready to plough", !ready.ready);
ok("and the reason is the missing plough", ready.summary.includes("missing plough"));

const plough = await add("plough", "Disc plough", PLOUGH);
ready = (await pairing.readinessFor(biz, ["ploughing"]))[0]!;
ok("owning both is still not ready", !ready.ready);
ok("because nobody has checked they fit", ready.summary.includes("needs checking"));

console.log("\nA recorded verdict is what makes it ready");
ok("the pairing saves", await pairing.savePairing(biz, owner, {
  machineId: tractor.id, implementId: plough.id, service: "ploughing",
  verdict: "compatible", basis: "Cat 2 hitch measured, 70 hp needed against 90 available",
}));
ready = (await pairing.readinessFor(biz, ["ploughing"]))[0]!;
ok("now it is ready", ready.ready);
ok("and says so plainly", ready.summary === "Ploughing ready");
ok("naming which two make it possible",
  ready.usableWith.some((u) => u.machineId === tractor.id && u.implementId === plough.id));

const saved = (await pairing.pairingsFor(biz, tractor.id))[0]!;
ok("who decided it is kept", saved.decidedBy === owner);
ok("so is when", saved.decidedAt !== "");
ok("so is what it rests on", saved.basis.includes("Cat 2"));

console.log("\nA verdict covers one service, not every service");
ready = (await pairing.readinessFor(biz, ["harrowing"]))[0]!;
ok("ploughing being approved says nothing about harrowing", !ready.ready);
ok("which is missing a harrow", ready.summary.includes("missing harrow"));

console.log("\nChanging a critical specification sends the pairing back");
ok("the recheck touches it", await pairing.recheckAfterSpecChange(biz, tractor.id, owner) === 1);
ok("the verdict is back to needing a check",
  (await pairing.pairingsFor(biz, tractor.id))[0]?.verdict === "checking");
ok("so the service is not ready again", !(await pairing.readinessFor(biz, ["ploughing"]))[0]!.ready);
ok("but the pairing row survives", (await pairing.pairingsFor(biz, tractor.id)).length === 1);

console.log("\nThe quote gate");
await pairing.savePairing(biz, owner, {
  machineId: tractor.id, implementId: plough.id, service: "ploughing", verdict: "compatible", basis: "Re-measured",
});
ok("a verified pair passes", (await pairing.kitProblem(biz, "ploughing", [tractor.id, plough.id])) === null);
ok("a tractor on its own does not",
  Boolean((await pairing.kitProblem(biz, "ploughing", [tractor.id]))?.why.includes("needs plough")));
ok("nor a plough on its own",
  Boolean((await pairing.kitProblem(biz, "ploughing", [plough.id]))?.why.includes("needs tractor")));
ok("a missing implement is a catalogue fact, so it always blocks",
  (await pairing.kitProblem(biz, "ploughing", [tractor.id]))?.pairing === false);

const other = await add("plough", "Unchecked plough", PLOUGH);
ok("an unconfirmed plough is refused by name",
  Boolean((await pairing.kitProblem(biz, "ploughing", [tractor.id, other.id]))?.why.includes("Unchecked plough")));
ok("and that one is a judgement, so the setting decides",
  (await pairing.kitProblem(biz, "ploughing", [tractor.id, other.id]))?.pairing === true);
await pairing.savePairing(biz, owner, {
  machineId: tractor.id, implementId: other.id, service: "ploughing", verdict: "incompatible", basis: "Too heavy for the linkage",
});
ok("one recorded as not compatible says so",
  Boolean((await pairing.kitProblem(biz, "ploughing", [tractor.id, other.id]))?.why.includes("not compatible")));

console.log("\nA self-contained machine needs nothing hitched to it");
const combine = await add("combine", "Rice combine", { ownEngine: "Own engine", power: "120", header: "3" });
ok("it is ready on its own", (await pairing.readinessFor(biz, ["combine_harvesting"]))[0]!.ready);
ok("and passes the quote gate alone", (await pairing.kitProblem(biz, "combine_harvesting", [combine.id])) === null);

console.log("\nEnforcement is a setting, off until Karim says otherwise");
ok("it is off by default", !(await pairing.pairingEnforced()));
await setSetting(staff, "pairing_enforced", "yes");
ok("and can be switched on", await pairing.pairingEnforced());
await setSetting(staff, "pairing_enforced", "no");
ok("and off again", !(await pairing.pairingEnforced()));

console.log("\nPairings belong to one business");
const rivalOwner = await user("Rival", "provider");
const rival = await business(rivalOwner, "Rival Pairing Co");
ok("a business cannot pair another's machines", !(await pairing.savePairing(rival, rivalOwner, {
  machineId: tractor.id, implementId: plough.id, service: "ploughing", verdict: "compatible", basis: "Not mine to say",
})));
ok("nothing was written", (await pairing.pairingsFor(rival)).length === 0);
ok("a machine cannot be paired with itself", !(await pairing.savePairing(biz, owner, {
  machineId: tractor.id, implementId: tractor.id, service: "ploughing", verdict: "compatible", basis: "",
})));

console.log("\nA blocked machine takes its services down with it");
await eq.setCondition(biz, owner, plough.id, "repair", "Share broken");
const after = (await pairing.readinessFor(biz, ["ploughing"]))[0]!;
ok("the only verified plough being under repair stops ploughing", !after.ready);
ok("the ledger was never involved", (await db.all("SELECT 1 FROM ledger_entry")).length === 0);

console.log(`\n${n - fails.length}/${n} checks passed.`);
if (fails.length) process.exit(1);
