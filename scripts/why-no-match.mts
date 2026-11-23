// Explains, for every open request, which approved providers can see it and which cannot — and
// for each one that cannot, the reason.
// Run: npm run db:why-no-match
//
// Reads only. It touches nothing, so it is safe against production.
//
// A provider is shown a request when one of their *active* coverage pairs matches it on BOTH
// district and service (src/lib/coverage.ts). Chiefdom and village are not part of matching at
// all and never have been: they are there so a provider knows where they are going, and so staff
// can find a farm. If a request is invisible, the reason is the district, the service, the pair
// being pending rather than active, the business not being approved, or the request being private
// or direct to somebody else.
process.env.SAGORA_SKIP_SCHEMA_CHECK = "1";

const { preferDirectConnection } = await import("./direct-connection.mjs");
preferDirectConnection();

const { db, describe } = await import("../src/lib/db");
const { coverageRows } = await import("../src/lib/coverage");

console.log(`Database: ${describe()}\n`);

type Req = {
  id: string; reference: string; service: string; district: string; chiefdom: string | null;
  village: string; status: string; private_to: string | null; direct_to: string | null;
};
type Biz = { id: string; name: string; district: string; services: string; status: string };

const requests = await db.all<Req>(
  `SELECT id, reference, service, district, chiefdom, village, status, private_to, direct_to
     FROM service_request WHERE status NOT IN ('cancelled','completed') ORDER BY created_at DESC`);
const businesses = await db.all<Biz>(
  "SELECT id, name, district, services, status FROM provider_business ORDER BY name");

if (requests.length === 0) console.log("No open requests.\n");

// Every business's coverage, read the same way the website reads it.
const coverage = new Map<string, { district: string; service: string; status: string }[]>();
for (const b of businesses) {
  const parsed: string[] = (() => { try { return JSON.parse(b.services || "[]"); } catch { return []; } })();
  coverage.set(b.id, await coverageRows({ id: b.id, district: b.district, services: parsed }));
}

console.log("PROVIDERS\n");
for (const b of businesses) {
  const rows = coverage.get(b.id) ?? [];
  const active = rows.filter((r) => r.status === "active");
  console.log(`  ${b.name}  [${b.status}]`);
  if (rows.length === 0) {
    console.log("    no coverage at all — this business is shown nothing except direct requests");
  }
  for (const r of rows) console.log(`    ${r.district} + ${r.service}  (${r.status})`);
  // The gap that bites: planting was added to Sagora after some providers were approved, so
  // their coverage predates it and they are shown no planting work in a district they work in.
  const districts = [...new Set(active.map((r) => r.district))];
  for (const d of districts) {
    const missing = ["ploughing", "harvesting", "planting"]
      .filter((s) => !active.some((r) => r.district === d && r.service === s));
    if (missing.length) console.log(`    note: in ${d} this business does NOT cover ${missing.join(", ")}`);
  }
  console.log("");
}

console.log("REQUESTS\n");
for (const r of requests) {
  console.log(`  ${r.reference}  ${r.service} in ${r.district}` +
    `${r.chiefdom ? ` / ${r.chiefdom} chiefdom` : ""}${r.village ? ` / ${r.village}` : ""}  [${r.status}]`);

  if (r.private_to) {
    const owner = businesses.find((b) => b.id === r.private_to);
    console.log(`    private to ${owner?.name ?? r.private_to} — no other provider is shown it\n`);
    continue;
  }

  const sees: string[] = [];
  const blind: string[] = [];
  for (const b of businesses) {
    const rows = coverage.get(b.id) ?? [];
    const active = rows.filter((x) => x.status === "active");

    if (r.direct_to) {
      if (r.direct_to === b.id) sees.push(`${b.name} (direct request)`);
      else blind.push(`${b.name}: this is a direct request for someone else`);
      continue;
    }
    if (b.status !== "approved") {
      blind.push(`${b.name}: business is "${b.status}", not approved`);
      continue;
    }
    if (active.some((x) => x.district === r.district && x.service === r.service)) {
      sees.push(b.name);
      continue;
    }
    // Say which half of the pair failed, because that is the whole question.
    const inDistrict = active.filter((x) => x.district === r.district);
    const pending = rows.find((x) => x.district === r.district && x.service === r.service && x.status === "pending");
    if (pending) {
      blind.push(`${b.name}: covers ${r.district} + ${r.service} but it is PENDING review, not active`);
    } else if (inDistrict.length > 0) {
      blind.push(`${b.name}: works in ${r.district}, but only for ${inDistrict.map((x) => x.service).join(", ")} ` +
        `— NOT ${r.service}`);
    } else if (active.length > 0) {
      blind.push(`${b.name}: does not work in ${r.district} (works in ${[...new Set(active.map((x) => x.district))].join(", ")})`);
    } else {
      blind.push(`${b.name}: has no active coverage`);
    }
  }

  console.log(`    SEEN BY: ${sees.length ? sees.join(", ") : "NOBODY"}`);
  for (const why of blind) console.log(`    not seen — ${why}`);
  console.log("");
}

console.log("Chiefdom and village play no part in matching. If a request is invisible, the reason");
console.log("is one of the ones printed above.");
