// A couple of machines on the demo provider's register, for looking at the Equipment screens
// locally. Dev only: it refuses to run against a hosted database.
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";
if (process.env.DATABASE_URL) {
  console.error("Refusing to run: DATABASE_URL is set. This is a local dev seed.");
  process.exit(1);
}
const { db } = await import("../src/lib/db");
const equipment = await import("../src/lib/equipment");
const downtime = await import("../src/lib/downtime");

const biz = await db.get(`SELECT b.id, b.user_id FROM provider_business b
  JOIN "user" u ON u.id = b.user_id WHERE u.email='demo.provider@sagora.sl'`) as { id: string; user_id: string } | undefined;
if (!biz) { console.error("No demo provider. Run npm run demo:accounts first."); process.exit(1); }

const existing = await equipment.listAssets(biz.id);
if (existing.length > 0) { console.log(`Already ${existing.length} machine(s).`); process.exit(0); }

const tractor = await equipment.addAsset(biz.id, biz.user_id, {
  kind: "tractor", name: "Massey 385", identifier: "MF385-2201", ownership: "owned", notes: "",
  brand: "Massey Ferguson", model: "385", horsepower: "85", services: ["ploughing", "planting"],
  specs: { power: "85", hitch: "Three-point category 2", lift: "2500" },
  location: "Makeni yard", custodian: "Abu Kamara",
});
const plough = await equipment.addAsset(biz.id, biz.user_id, {
  kind: "plough", name: "Disc plough, 3-furrow", identifier: "DP3-118", ownership: "owned", notes: "",
  services: ["ploughing"], specs: { powerNeeded: "70", hitch: "Three-point category 2" },
});
await equipment.reportFault(biz.id, biz.user_id, tractor.id, "minor", "Offside mirror cracked");
const d = new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10);
const e = new Date(Date.now() + 16 * 86400000).toISOString().slice(0, 10);
await downtime.recordDowntime(biz.id, biz.user_id, {
  equipmentId: tractor.id, kind: "service", fromDate: d, toDate: e, reason: "250-hour service",
});
console.log(`Added ${tractor.name} and ${plough.name}, one fault, one booked-out span.`);
