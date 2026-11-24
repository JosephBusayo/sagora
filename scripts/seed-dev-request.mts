// A farmer and one request, so the admin routing log has something to show locally. Dev only.
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";
if (process.env.DATABASE_URL) { console.error("Refusing to run: DATABASE_URL is set."); process.exit(1); }
const { db } = await import("../src/lib/db");
const requests = await import("../src/lib/requests");
const routing = await import("../src/lib/routing");

const farmer = await db.get(`SELECT id FROM "user" WHERE email='demo.farmer@sagora.sl'`) as { id: string } | undefined;
if (!farmer) { console.error("No demo farmer. Run npm run demo:accounts first."); process.exit(1); }

const made: string[] = [];
for (const [service, district] of [["ploughing", "Bo"], ["planting", "Kono"]] as const) {
  const r = await requests.createRequest(farmer.id, {
    service, services: [service], acres: 3, landAccess: "easy", landCondition: "",
    landClearance: "cleared", district, village: "Dev village",
    preferredDate: new Date(Date.now() + 21 * 86400000).toISOString().slice(0, 10),
    alternateDate: null, notes: "", contactName: "Demo Farmer", contactPhone: "76111222",
    contactEmail: "demo.farmer@sagora.sl", submissionKey: null,
  });
  const covering = await requests.providersCovering({ district, service });
  await routing.recordRouting({ id: r.id, district, service }, covering.map((c) => c.businessId));
  made.push(`${r.reference} (${service} in ${district}, ${covering.length} told)`);
}
console.log(`Added ${made.join("; ")}`);
