import "server-only";
import { db } from "./db";
import { DISTRICTS, SERVICES, audit } from "./business";

/**
 * Where a provider works (UC04): district and service pairs. Only active pairs bring requests.
 * A pair asked for after approval waits for Sagora's review (UC03); dropping one is immediate.
 */

export type Area = { district: string; service: string };
export type AreaStatus = "active" | "pending";
export type CoverageRow = Area & { status: AreaStatus };
/** What a business may be shown and quote on. */
export type Coverage = { id: string; areas: Area[] };

type HasHome = { id: string; district: string; services: string[] };

const homeAreas = (b: HasHome): Area[] => (b.district ? b.services.map((service) => ({ district: b.district, service })) : []);

/** Every pair, pending ones too. A business with none yet is read as its setup district and services. */
export async function coverageRows(b: HasHome): Promise<CoverageRow[]> {
  const rows = await db.all("SELECT district, service, status FROM provider_coverage WHERE business_id=? ORDER BY district, service", b.id) as CoverageRow[];
  return rows.length ? rows : homeAreas(b).map((a) => ({ ...a, status: "active" as const }));
}

export async function coverageOf(b: HasHome): Promise<Coverage> {
  return { id: b.id, areas: (await coverageRows(b)).filter((r) => r.status === "active") };
}

export const inAreas = (areas: Area[], r: { district: string; service: string }) =>
  areas.some((a) => a.district === r.district && a.service === r.service);

/** A direct request belongs to its chosen business alone, whatever anyone else covers. */
export const covers = (c: Coverage, r: { district: string; service: string; directTo?: string | null }) =>
  r.directTo ? r.directTo === c.id : inAreas(c.areas, r);

/** Before the first change, the setup pairs are written down, so asking for more never loses them. */
async function writeHome(b: HasHome, at: string) {
  for (const a of homeAreas(b)) {
    await db.run(`INSERT INTO provider_coverage (business_id, district, service, status, requested_at, decided_at)
       VALUES (?,?,?,'active',?,?) ON CONFLICT DO NOTHING`, b.id, a.district, a.service, at, at);
  }
}

/** The setup district and services start working the moment the business is approved. */
export async function activateHome(b: HasHome, staffId: string): Promise<void> {
  const now = new Date().toISOString();
  for (const a of homeAreas(b)) {
    await db.run(`INSERT INTO provider_coverage (business_id, district, service, status, requested_at, decided_by, decided_at)
       VALUES (?,?,?,'active',?,?,?) ON CONFLICT (business_id, district, service) DO UPDATE SET status='active', decided_by=excluded.decided_by, decided_at=excluded.decided_at`,
      b.id, a.district, a.service, now, staffId, now);
  }
}

const validDistrict = (d: string) => (DISTRICTS as readonly string[]).includes(d);
const validService = (s: string) => SERVICES.some((x) => x.id === s);

/** Asks to work somewhere new. Returns how many pairs now wait for review. */
export async function askForAreas(b: HasHome, userId: string, district: string, services: string[]): Promise<number> {
  if (!validDistrict(district)) return 0;
  const now = new Date().toISOString();
  const existing = await db.get("SELECT COUNT(*) AS n FROM provider_coverage WHERE business_id=?", b.id) as { n: number | string };
  if (Number(existing.n) === 0) await writeHome(b, now);
  let added = 0;
  for (const service of services.filter(validService)) {
    const res = await db.run(`INSERT INTO provider_coverage (business_id, district, service, status, requested_by, requested_at)
       VALUES (?,?,?,'pending',?,?) ON CONFLICT DO NOTHING`, b.id, district, service, userId, now);
    added += res.changes;
  }
  if (added) await audit(userId, "coverage.requested", b.id, `${district}: ${services.join(", ")}`);
  return added;
}

/** Stops one pair at once. The last active pair stays, or the business would get nothing at all. */
export async function dropArea(b: HasHome, userId: string, district: string, service: string): Promise<"dropped" | "last" | "missing"> {
  const now = new Date().toISOString();
  const existing = await db.get("SELECT COUNT(*) AS n FROM provider_coverage WHERE business_id=?", b.id) as { n: number | string };
  if (Number(existing.n) === 0) await writeHome(b, now);
  const row = await db.get("SELECT status FROM provider_coverage WHERE business_id=? AND district=? AND service=?", b.id, district, service) as { status: AreaStatus } | undefined;
  if (!row) return "missing";
  if (row.status === "active") {
    const active = await db.get("SELECT COUNT(*) AS n FROM provider_coverage WHERE business_id=? AND status='active'", b.id) as { n: number | string };
    if (Number(active.n) <= 1) return "last";
  }
  await db.run("DELETE FROM provider_coverage WHERE business_id=? AND district=? AND service=?", b.id, district, service);
  await audit(userId, "coverage.dropped", b.id, `${district}: ${service}`);
  return "dropped";
}

export type PendingChange = { businessId: string; name: string; email: string; areas: Area[]; current: Area[]; requestedAt: string };

/** For staff: each business with pairs waiting, beside what it already covers. */
export async function pendingChanges(): Promise<PendingChange[]> {
  const rows = await db.all(`SELECT c.business_id AS business_id, c.district AS district, c.service AS service, c.status AS status,
         c.requested_at AS requested_at, b.name AS name, b.email AS email
       FROM provider_coverage c JOIN provider_business b ON b.id = c.business_id
       WHERE c.business_id IN (SELECT business_id FROM provider_coverage WHERE status='pending')
       ORDER BY c.requested_at, c.district, c.service`) as
    { business_id: string; district: string; service: string; status: AreaStatus; requested_at: string; name: string; email: string }[];
  const by = new Map<string, PendingChange>();
  for (const r of rows) {
    const p = by.get(r.business_id) ?? { businessId: r.business_id, name: r.name, email: r.email, areas: [], current: [], requestedAt: r.requested_at };
    (r.status === "pending" ? p.areas : p.current).push({ district: r.district, service: r.service });
    if (r.status === "pending" && r.requested_at < p.requestedAt) p.requestedAt = r.requested_at;
    by.set(r.business_id, p);
  }
  return [...by.values()];
}

/** Staff decide every waiting pair of one business together. Declined pairs are removed. */
export async function decideAreas(businessId: string, staffId: string, approve: boolean): Promise<number> {
  const now = new Date().toISOString();
  const res = approve
    ? await db.run("UPDATE provider_coverage SET status='active', decided_by=?, decided_at=? WHERE business_id=? AND status='pending'", staffId, now, businessId)
    : await db.run("DELETE FROM provider_coverage WHERE business_id=? AND status='pending'", businessId);
  if (res.changes) await audit(staffId, approve ? "coverage.approved" : "coverage.declined", businessId, String(res.changes));
  return res.changes;
}

/** "Bo District: Ploughing, Harvesting", one line per district. */
export function byDistrict(areas: Area[]): { district: string; services: string[] }[] {
  const m = new Map<string, string[]>();
  for (const a of areas) m.set(a.district, [...(m.get(a.district) ?? []), a.service]);
  return [...m.entries()].map(([district, services]) => ({ district, services }));
}
