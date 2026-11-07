import "server-only";
import { randomUUID } from "node:crypto";
import { db, type Queries } from "./db";
import { DISTRICTS, SERVICES, audit } from "./business";
import { coverageOf, type Coverage } from "./coverage";

/**
 * Service requests: a farmer asks for ploughing or harvesting, providers see it and
 * (from the next stage) quote for it.
 *
 * A request is NOT a booking. It carries no price, no commitment and no reserved machine.
 * That line is a rule from the brief and the reason the states below never say "Pending".
 */

export type RequestStatus = "awaiting_quotes" | "quotes_sent" | "in_progress" | "completed" | "cancelled";

/** Plain words, never a bare "Pending" (brief rule). */
export const STATUS_LABEL: Record<RequestStatus, string> = {
  awaiting_quotes: "Awaiting quotes",
  quotes_sent: "Quotes sent",
  in_progress: "In progress",
  completed: "Completed",
  cancelled: "Cancelled",
};

export type ServiceRequest = {
  id: string;
  reference: string;
  farmerId: string | null;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  service: string;
  acres: number;
  landAccess: string;
  landCondition: string;
  landClearance: string;
  crop: string;
  /** UC06: upland or lowland, and for harvesting the variety, planting date and readiness. */
  landType: string;
  cropVariety: string;
  plantedOn: string;
  cropReadiness: string;
  /** The one business this stays with. Never converted into a general request. */
  directTo: string | null;
  /** The coordinator who took it, when the farmer has no account. */
  assistedBy: string | null;
  callerName: string;
  callerRelation: string;
  mayAccept: string;
  preferredDate: string;
  alternateDate: string | null;
  district: string;
  /** Empty in the Western Area, and on requests made before it was asked. */
  chiefdom: string;
  village: string;
  notes: string;
  status: RequestStatus;
  createdAt: string;
};

type Row = {
  id: string; reference: string; farmer_id: string | null; contact_name: string; contact_phone: string;
  contact_email: string; service: string; acres: number; land_access: string; land_condition: string;
  land_clearance: string; crop: string; land_type?: string; crop_variety?: string; planted_on?: string; crop_readiness?: string; direct_to: string | null; assisted_by: string | null;
  caller_name: string; caller_relation: string; may_accept: string; preferred_date: string; alternate_date: string | null;
  district: string; chiefdom: string | null; village: string; notes: string; status: RequestStatus; created_at: string;
};

const fromRow = (r: Row): ServiceRequest => ({
  id: r.id, reference: r.reference, farmerId: r.farmer_id, contactName: r.contact_name,
  contactPhone: r.contact_phone, contactEmail: r.contact_email, service: r.service, acres: r.acres,
  landAccess: r.land_access, landCondition: r.land_condition, landClearance: r.land_clearance,
  crop: r.crop, landType: r.land_type ?? "", cropVariety: r.crop_variety ?? "", plantedOn: r.planted_on ?? "", cropReadiness: r.crop_readiness ?? "",
  directTo: r.direct_to, assistedBy: r.assisted_by, callerName: r.caller_name,
  callerRelation: r.caller_relation, mayAccept: r.may_accept,
  preferredDate: r.preferred_date, alternateDate: r.alternate_date, district: r.district,
  chiefdom: r.chiefdom ?? "", village: r.village, notes: r.notes, status: r.status, createdAt: r.created_at,
});

export const serviceLabel = (id: string) => SERVICES.find((s) => s.id === id)?.label ?? id;

/**
 * Human reference, as in the design: SG-1048. Takes the transaction it must run in, so the
 * number and the request it belongs to are allocated together or not at all.
 */
export async function nextReference(t: Queries): Promise<string> {
  await t.run("INSERT INTO reference_counter (name, value) VALUES ('request', 1047) ON CONFLICT(name) DO NOTHING");
  await t.run("UPDATE reference_counter SET value = value + 1 WHERE name = 'request'");
  const row = (await t.get("SELECT value FROM reference_counter WHERE name = 'request'")) as { value: number };
  return `SG-${row.value}`;
}

export type Assisted = { by: string; callerName: string; callerRelation: string; mayAccept: string };

export type NewRequest = {
  service: string;
  acres: number;
  landAccess: string;
  landCondition: string;
  landClearance: string;
  crop?: string;
  landType?: string;
  cropVariety?: string;
  plantedOn?: string;
  cropReadiness?: string;
  directTo?: string | null;
  assisted?: Assisted;
  preferredDate: string;
  alternateDate: string | null;
  district: string;
  chiefdom?: string;
  village: string;
  notes: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  /** The form's own key, the same on every send of that form. See migration 011. */
  submissionKey?: string | null;
};

/** A key the server made for a form: anything else is ignored rather than trusted. */
export const isSubmissionKey = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);

/** How long an identical request counts as a resubmission of the first, not a new one. */
const RESUBMIT_WINDOW_MS = 10 * 60_000;

export async function createRequest(farmerId: string | null, input: NewRequest): Promise<ServiceRequest> {
  const now = new Date().toISOString();
  const id = randomUUID();
  // One transaction, so a reference is never allocated without the request it belongs to.
  const owner = input.assisted?.by ?? farmerId;
  let key = input.submissionKey && isSubmissionKey(input.submissionKey) ? input.submissionKey : null;
  const reference = await db.tx(async (t) => {
    // The same form sent again: the request it already made, whatever happened to the first reply.
    const sentBefore = async () => key ? await t.get(`SELECT id, reference, farmer_id, assisted_by FROM service_request WHERE submission_key=?`, key) as
      { id: string; reference: string; farmer_id: string | null; assisted_by: string | null } | undefined : undefined;
    const before = await sentBefore();
    if (before) {
      // A key only ever answers for whoever made it.
      if ((before.assisted_by ?? before.farmer_id) === owner) return { existing: before.id, reference: before.reference };
      key = null;
    }
    // A farmer whose connection dropped and who sends the same form again gets the request they
    // already made, not a second one with its own reference.
    if (farmerId && !input.assisted) {
      const same = await t.get(`SELECT id, reference FROM service_request
           WHERE farmer_id=? AND service=? AND acres=? AND district=? AND village=? AND preferred_date=?
             AND COALESCE(direct_to, '')=? AND status='awaiting_quotes' AND created_at >= ?
           ORDER BY created_at DESC LIMIT 1`, farmerId, input.service, input.acres, input.district, input.village, input.preferredDate,
        input.directTo ?? "", new Date(Date.now() - RESUBMIT_WINDOW_MS).toISOString()) as { id: string; reference: string } | undefined;
      if (same) return { existing: same.id, reference: same.reference };
    }
    const next = await nextReference(t);
    const inserted = await t.run(`INSERT INTO service_request
        (id, reference, farmer_id, contact_name, contact_phone, contact_email, service, acres,
         land_access, land_condition, land_clearance, crop, direct_to, assisted_by, caller_name, caller_relation, may_accept,
         preferred_date, alternate_date, district, chiefdom, village, notes, submission_key, created_at, updated_at,
         land_type, crop_variety, planted_on, crop_readiness)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`, id, next, farmerId, input.contactName, input.contactPhone, input.contactEmail,
      input.service, input.acres, input.landAccess, input.landCondition, input.landClearance, input.crop ?? "", input.directTo ?? null,
      input.assisted?.by ?? null, input.assisted?.callerName ?? "", input.assisted?.callerRelation ?? "", input.assisted?.mayAccept ?? "",
      input.preferredDate, input.alternateDate, input.district, input.chiefdom ?? "",
      input.village, input.notes, key, now, now,
      input.landType ?? "", input.cropVariety ?? "", input.plantedOn ?? "", input.cropReadiness ?? "");
    if (!inserted.changes) {
      // Both sends arrived together and the other one saved first.
      const other = await sentBefore();
      if (other) return { existing: other.id, reference: other.reference };
    }
    return { existing: null, reference: next };
  });
  if (reference.existing) return (await getById(reference.existing))!;
  await audit(input.assisted?.by ?? farmerId ?? "guest", input.assisted ? "request.assisted" : "request.created", id, reference.reference);
  return (await getById(id))!;
}

/** Details only, and only while nobody has priced them: what a provider quoted must not move. */
export async function updateRequest(
  farmerId: string, id: string,
  d: Omit<NewRequest, "contactName" | "contactPhone" | "contactEmail" | "directTo" | "assisted">,
): Promise<boolean> {
  const res = await db.run(`UPDATE service_request SET service=?, acres=?, land_access=?, land_condition=?, land_clearance=?, crop=?,
       preferred_date=?, alternate_date=?, district=?, chiefdom=?, village=?, notes=?, updated_at=?,
       land_type=?, crop_variety=?, planted_on=?, crop_readiness=?
       WHERE id=? AND ${OWNED_BY()} AND status='awaiting_quotes'`,
    d.service, d.acres, d.landAccess, d.landCondition, d.landClearance, d.crop ?? "", d.preferredDate, d.alternateDate,
    d.district, d.chiefdom ?? "", d.village, d.notes, new Date().toISOString(),
    d.landType ?? "", d.cropVariety ?? "", d.plantedOn ?? "", d.cropReadiness ?? "", id, farmerId, farmerId);
  if (res.changes) await audit(farmerId, "request.edited", id);
  return res.changes > 0;
}

export async function getById(id: string): Promise<ServiceRequest | null> {
  const r = await db.get("SELECT * FROM service_request WHERE id = ?", id) as Row | undefined;
  return r ? fromRow(r) : null;
}

export async function getByReference(reference: string): Promise<ServiceRequest | null> {
  const r = await db.get("SELECT * FROM service_request WHERE reference = ?", reference) as Row | undefined;
  return r ? fromRow(r) : null;
}

export async function listForFarmer(farmerId: string): Promise<ServiceRequest[]> {
  const rows = await db.all("SELECT * FROM service_request WHERE farmer_id = ? ORDER BY created_at DESC", farmerId) as Row[];
  return rows.map(fromRow);
}

/* --------------------------------------------------------- provider browse */

export type Filters = { service?: string; district?: string; window?: string; reference?: string };

/** The business a list is for: its coverage is read from lib/coverage.ts. */
type Provider = { id: string; district: string; services: string[] };

/** Requests sent to this business, and open requests in any district and service it covers. */
function coverageClause(c: Coverage, where: string[], params: (string | number)[]) {
  if (!c.areas.length) {
    where.push("direct_to = ?");
    params.push(c.id);
    return;
  }
  where.push(`(direct_to = ? OR (direct_to IS NULL AND (${c.areas.map(() => "(district = ? AND service = ?)").join(" OR ")})))`);
  params.push(c.id, ...c.areas.flatMap((a) => [a.district, a.service]));
}
export const DATE_WINDOWS = [
  { id: "", label: "All dates" },
  { id: "30", label: "Next 30 days" },
  { id: "90", label: "Next 3 months" },
  { id: "past", label: "Date has passed" },
] as const;

export const PAGE_SIZE = 7;

/**
 * What a provider can browse. Only the farmer's service details are listed: name, phone and
 * email stay out until there is a reason to share them, which is the quote stage.
 */
export async function browse(filters: Filters, page: number, business: Provider): Promise<{ rows: ServiceRequest[]; total: number; pages: number }> {
  const where: string[] = ["status <> 'cancelled'", "private_to IS NULL"];
  const params: (string | number)[] = [];
  coverageClause(await coverageOf(business), where, params);
  if (filters.reference) {
    where.push("reference = ?");
    params.push(filters.reference);
  }
  if (filters.service && SERVICES.some((s) => s.id === filters.service)) {
    where.push("service = ?");
    params.push(filters.service);
  }
  if (filters.district && (DISTRICTS as readonly string[]).includes(filters.district)) {
    where.push("district = ?");
    params.push(filters.district);
  }
  const today = new Date().toISOString().slice(0, 10);
  if (filters.window === "past") {
    where.push("preferred_date < ?");
    params.push(today);
  } else if (filters.window === "30" || filters.window === "90") {
    const end = new Date(Date.now() + Number(filters.window) * 86400000).toISOString().slice(0, 10);
    where.push("preferred_date >= ? AND preferred_date <= ?");
    params.push(today, end);
  }
  const clause = `WHERE ${where.join(" AND ")}`;
  const total = Number((await db.get(`SELECT COUNT(*) AS n FROM service_request ${clause}`, ...params) as { n: number }).n);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pages);
  const rows = await db.all(`SELECT * FROM service_request ${clause} ORDER BY preferred_date ASC, created_at DESC LIMIT ? OFFSET ?`, ...params, PAGE_SIZE, (safePage - 1) * PAGE_SIZE) as Row[];
  return { rows: rows.map(fromRow), total, pages };
}

/** Matches a reference, village or district. LIKE wildcards in the search are taken literally. */
const likeTerm = (q: string) => `%${q.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
const REQUEST_MATCH = `(LOWER(reference) LIKE ? ESCAPE '\\' OR LOWER(village) LIKE ? ESCAPE '\\' OR LOWER(district) LIKE ? ESCAPE '\\')`;

export async function searchForFarmer(farmerId: string, q: string): Promise<ServiceRequest[]> {
  const t = likeTerm(q);
  const rows = await db.all(`SELECT * FROM service_request WHERE farmer_id=? AND ${REQUEST_MATCH} ORDER BY created_at DESC LIMIT 25`, farmerId, t, t, t) as Row[];
  return rows.map(fromRow);
}

/** The same list a provider can browse: no contact details, nothing withdrawn. */
export async function searchForProvider(q: string, business: Provider): Promise<ServiceRequest[]> {
  const t = likeTerm(q);
  const where: string[] = [];
  const params: (string | number)[] = [];
  coverageClause(await coverageOf(business), where, params);
  const also = ` AND ${where.join(" AND ")}`;
  const rows = await db.all(`SELECT * FROM service_request WHERE status <> 'cancelled' AND private_to IS NULL${also} AND ${REQUEST_MATCH} ORDER BY created_at DESC LIMIT 25`, ...params, t, t, t) as Row[];
  return rows.map(fromRow);
}

/** Approved businesses covering this request, to tell them it exists. Their own sign-in email. */
export async function providersCovering(r: { district: string; service: string }): Promise<{ businessId: string; email: string }[]> {
  // A business with no coverage rows yet is matched on its setup district and services.
  const rows = await db.all(`SELECT b.id AS id, u.email AS email FROM provider_business b
       JOIN "user" u ON u.id = b.user_id
       WHERE b.status = 'approved' AND (
         EXISTS (SELECT 1 FROM provider_coverage c WHERE c.business_id = b.id AND c.status = 'active' AND c.district = ? AND c.service = ?)
         OR (NOT EXISTS (SELECT 1 FROM provider_coverage c WHERE c.business_id = b.id) AND b.district = ? AND b.services LIKE ?))`,
    r.district, r.service, r.district, `%"${r.service}"%`) as { id: string; email: string }[];
  return rows.map((b) => ({ businessId: b.id, email: b.email }));
}

/**
 * Who may act on a request as its farmer: the farmer's own account id, or, for a request sent
 * without an account, "guest:<request id>", which only lib/guest.ts hands out, and only to a browser
 * that came in with the request's tracking code and phone number.
 */
export const guestActor = (requestId: string) => `guest:${requestId}`;

/** SQL for "this actor owns the request row"; binds the actor twice. `a` is the table alias with its dot. */
export const OWNED_BY = (a = "") => `(${a}farmer_id = ? OR (${a}farmer_id IS NULL AND ? = 'guest:' || ${a}id))`;

export const ownedBy = (r: { id: string; farmerId: string | null }, actor: string) =>
  r.farmerId ? r.farmerId === actor : actor === guestActor(r.id);

/** A farmer can withdraw their own request while nobody has started work. */
export async function cancel(farmerId: string, id: string): Promise<boolean> {
  const res = await db.run(`UPDATE service_request SET status='cancelled', updated_at=?
       WHERE id=? AND ${OWNED_BY()} AND status IN ('awaiting_quotes','quotes_sent')`, new Date().toISOString(), id, farmerId, farmerId);
  if (res.changes) await audit(farmerId, "request.cancelled", id);
  return res.changes > 0;
}

/* ---------------------------------------------------------- assisted requests */

/** The local part of a number, so 076 123 456, +23276123456 and 23276123456 match. */
export const phoneKey = (p: string) => p.replace(/\D/g, "").slice(-8);

/**
 * Open requests already made from this number (UC07): a second call about the same job is added
 * to the first record rather than making another booking. Matching is done here rather than in
 * SQL because numbers were typed in many shapes.
 */
export async function openRequestsForPhone(phone: string): Promise<ServiceRequest[]> {
  const want = phoneKey(phone);
  if (want.length < 6) return [];
  const rows = await db.all(`SELECT * FROM service_request WHERE status NOT IN ('cancelled','completed') AND private_to IS NULL
       ORDER BY created_at DESC LIMIT 2000`) as Row[];
  return rows.map(fromRow).filter((r) => phoneKey(r.contactPhone) === want);
}

export type ContactEntry = { id: string; outcome: string; createdAt: string };

export async function listAssisted(): Promise<ServiceRequest[]> {
  const rows = await db.all("SELECT * FROM service_request WHERE assisted_by IS NOT NULL ORDER BY created_at DESC LIMIT 100") as Row[];
  return rows.map(fromRow);
}

export async function contactsFor(requestId: string): Promise<ContactEntry[]> {
  const rows = await db.all("SELECT id, outcome, created_at FROM request_contact WHERE request_id=? ORDER BY created_at DESC", requestId) as { id: string; outcome: string; created_at: string }[];
  return rows.map((r) => ({ id: r.id, outcome: r.outcome, createdAt: r.created_at }));
}

export async function logContact(staffId: string, requestId: string, outcome: string): Promise<void> {
  await db.run("INSERT INTO request_contact (id, request_id, staff_id, outcome, created_at) VALUES (?,?,?,?,?)", randomUUID(), requestId, staffId, outcome, new Date().toISOString());
}
