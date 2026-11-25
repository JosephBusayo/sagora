/**
 * Where a provider works, and the order things are shown in. Run against a throwaway database:
 *   DATABASE_PATH=<scratch>/l.db npm run db:migrate && DATABASE_PATH=<scratch>/l.db npm run check:locations
 *
 * Joseph, 25 Nov 2026. Two rules that had quietly been one:
 *
 *   "The provider's official office address must NOT determine whether they receive a farmer's
 *    request. Request matching must use the provider's selected operating districts."
 *
 * Before migration 034 a business had a single district doing both jobs, so an office in Bombali
 * was an offer to work in Bombali whatever the provider had actually agreed to cover. These prove
 * the two are now separate in both directions: the office brings nothing, and the operating list
 * brings everything.
 *
 * The ordering rules are here too, because they are the same kind of thing — what a person is
 * shown, and in what order — and because sorting is easy to break from a long way away.
 */
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";
import { randomUUID } from "node:crypto";
const { db } = await import("../src/lib/db");
const requests = await import("../src/lib/requests");
const coverage = await import("../src/lib/coverage");
const business = await import("../src/lib/business");
const catalogue = await import("../src/lib/catalogue");
const { user } = await import("./fixtures.mjs");

const fails: string[] = [];
let n = 0;
const ok = (what: string, cond: boolean) => {
  n++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${what}`);
  if (!cond) fails.push(what);
};

const now = new Date().toISOString();
const inDays = (d: number) => new Date(Date.now() + d * 86400_000).toISOString().slice(0, 10);

/** A business with an office in one district and an offer to work in others. */
async function provider(name: string, office: string, works: string[], services: string[]) {
  const owner = await user(`Owner ${name}`, "provider");
  const id = randomUUID();
  await db.run(`INSERT INTO provider_business (id, user_id, name, phone, email, district, town, office_address,
       operating_districts, services, status, created_at, updated_at)
     VALUES (?,?,?,'76000000',?,?,'Town','12 Mango Street',?,?,'approved',?,?)`,
    id, owner, name, `${id}@example.test`, office, JSON.stringify(works), JSON.stringify(services), now, now);
  return { id, owner, operatingDistricts: works, services };
}

const farmer = await user("Location Farmer");
const request = (district: string, service: string, village: string) =>
  requests.createRequest(farmer, {
    service, acres: 5, district, village, landAccess: "easy", landCondition: "",
    landClearance: "cleared", crop: "Rice", notes: "", preferredDate: inDays(14), alternateDate: null,
    contactName: "F", contactPhone: "76000111", contactEmail: "f@example.test",
  });

/* ----------------------------------------- the office is an address, not an offer */

console.log("\nThe office district brings no work on its own");
// Exactly the handover's example: an office in Bombali, working in Bombali and Tonkolili.
const both = await provider("Office Bombali", "Bombali", ["Bombali", "Tonkolili"], ["harvesting"]);
// And the mirror image: an office in Tonkolili that has not offered to work there.
const elsewhere = await provider("Office Tonkolili", "Tonkolili", ["Port Loko"], ["harvesting"]);

const inTonkolili = await request("Tonkolili", "harvesting", "Magburaka");
const told = (await requests.providersCovering({ district: "Tonkolili", service: "harvesting" })).map((p) => p.businessId);
ok("a provider who works there is told, though the office is elsewhere", told.includes(both.id));
ok("a provider whose office is there but who does not work there is not told", !told.includes(elsewhere.id));

ok("and the same answer comes back through browse",
  (await requests.browse({}, 1, both)).rows.some((r) => r.id === inTonkolili.id));
ok("browse agrees about the one who does not work there",
  !(await requests.browse({}, 1, elsewhere)).rows.some((r) => r.id === inTonkolili.id));

console.log("\nBoth halves have to match: the district and the service");
const ploughsOnly = await provider("Ploughs Only", "Bombali", ["Tonkolili"], ["ploughing"]);
const toldHarvest = (await requests.providersCovering({ district: "Tonkolili", service: "harvesting" })).map((p) => p.businessId);
ok("working there is not enough without the service", !toldHarvest.includes(ploughsOnly.id));
ok("but it is enough for the service they do offer",
  (await requests.providersCovering({ district: "Tonkolili", service: "ploughing" })).some((p) => p.businessId === ploughsOnly.id));

console.log("\nThe coverage a business starts with is read from where it works");
const areas = (await coverage.coverageOf(both)).areas;
ok("one pair per district it works in", areas.length === 2);
ok("Bombali is covered", areas.some((a) => a.district === "Bombali" && a.service === "harvesting"));
ok("Tonkolili is covered", areas.some((a) => a.district === "Tonkolili" && a.service === "harvesting"));
ok("and nothing is covered in the office district by virtue of being the office",
  !(await coverage.coverageOf(elsewhere)).areas.some((a) => a.district === "Tonkolili"));

/* ----------------------------------------------- only the districts Sagora works in */

console.log("\nOnly the three districts Sagora operates in may be chosen");
ok("there are three", business.OPERATING_DISTRICTS.length === 3);
ok("Bombali, Tonkolili and Port Loko", business.OPERATING_DISTRICTS.join(", ") === "Bombali, Tonkolili, Port Loko");
ok("all sixteen are still known, so older rows still read", business.DISTRICTS.length === 16);
ok("asking to work somewhere Sagora does not operate is refused",
  (await coverage.askForAreas(both, both.owner, "Bo", ["ploughing"])) === 0);
ok("asking to work somewhere it does is accepted",
  (await coverage.askForAreas(both, both.owner, "Port Loko", ["harvesting"])) === 1);
ok("and it waits for review rather than starting at once",
  (await coverage.coverageRows(both)).some((r) => r.district === "Port Loko" && r.status === "pending"));
ok("a request being edited keeps the district it already has",
  business.districtChoicesFor("Bo").includes("Bo") && business.districtChoicesFor("Bo").length === 4);
ok("a new one is offered only the three", business.districtChoicesFor(null).length === 3);

/* ------------------------------------------------------------------ what is shown first */

console.log("\nServices are offered in the order the work happens");
ok("ploughing, then planting, then harvesting",
  catalogue.activeServices().map((s) => s.label).join(", ") === "Ploughing, Planting, Harvesting");
ok("which is the order a package is planned in too",
  catalogue.inFieldOrder(["harvesting", "ploughing", "planting"]).join(",") === "ploughing,planting,harvesting");
ok("and it is not alphabetical",
  catalogue.activeServices().map((s) => s.label).join(",") !== [...catalogue.activeServices()].map((s) => s.label).sort().join(","));

console.log("\nThe newest request is the first one shown");
const older = await request("Bombali", "harvesting", "Makeni old");
await new Promise((r) => setTimeout(r, 5));
const newer = await request("Bombali", "harvesting", "Makeni new");
const list = await requests.browse({}, 1, both);
const positions = list.rows.map((r) => r.id);
ok("the provider sees the newest first", positions.indexOf(newer.id) < positions.indexOf(older.id));
ok("the newest of all is at the top", positions[0] === newer.id);

const mine = await requests.listForFarmer(farmer);
ok("the farmer sees the newest first too", mine[0]?.id === newer.id);
ok("and in strictly descending order of when they were made",
  mine.every((r, i) => i === 0 || mine[i - 1].createdAt >= r.createdAt));

// Paging reads from the same ordered query, so page 2 carries on where page 1 stopped rather
// than being sorted again afterwards.
console.log("\nPaging and filtering keep that order");
const page1 = await requests.browse({}, 1, both);
ok("every row on the page is in order",
  page1.rows.every((r, i) => i === 0 || page1.rows[i - 1].createdAt >= r.createdAt));
const filtered = await requests.browse({ district: "Bombali" }, 1, both);
ok("a filtered list is in the same order",
  filtered.rows.every((r, i) => i === 0 || filtered.rows[i - 1].createdAt >= r.createdAt));
ok("and the filter did not lose the newest", filtered.rows.some((r) => r.id === newer.id));

console.log("\nNothing here touched the money");
ok("the ledger was never involved", (await db.all("SELECT 1 FROM ledger_entry")).length === 0);

console.log(`\n${n - fails.length}/${n} checks passed.`);
if (fails.length) process.exit(1);
