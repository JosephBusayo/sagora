import "server-only";
import { randomUUID } from "node:crypto";
import { changed, db } from "./db";
import { DISTRICTS, SERVICES, audit } from "./business";

/**
 * Service requests: a farmer asks for ploughing or harvesting, providers see it and
 * (from the next stage) quote for it.
 *
 * A request is NOT a booking. It carries no price, no commitment and no reserved machine.
 * That line is a rule from the brief and the reason the states below never say "Pending".
 */

db.exec(`
CREATE TABLE IF NOT EXISTS service_request (
  id TEXT PRIMARY KEY,
  reference TEXT NOT NULL UNIQUE,
  farmer_id TEXT,
  contact_name TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  service TEXT NOT NULL,
  acres REAL NOT NULL,
  preferred_date TEXT NOT NULL,
  alternate_date TEXT,
  district TEXT NOT NULL,
  village TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'awaiting_quotes'
    CHECK (status IN ('awaiting_quotes','quotes_sent','in_progress','completed','cancelled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS service_request_farmer ON service_request (farmer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS service_request_browse ON service_request (status, district, service, preferred_date);
CREATE TABLE IF NOT EXISTS reference_counter (name TEXT PRIMARY KEY, value INTEGER NOT NULL);
`);

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
  preferredDate: string;
  alternateDate: string | null;
  district: string;
  village: string;
  notes: string;
  status: RequestStatus;
  createdAt: string;
};

type Row = {
  id: string; reference: string; farmer_id: string | null; contact_name: string; contact_phone: string;
  contact_email: string; service: string; acres: number; preferred_date: string; alternate_date: string | null;
  district: string; village: string; notes: string; status: RequestStatus; created_at: string;
};

const fromRow = (r: Row): ServiceRequest => ({
  id: r.id, reference: r.reference, farmerId: r.farmer_id, contactName: r.contact_name,
  contactPhone: r.contact_phone, contactEmail: r.contact_email, service: r.service, acres: r.acres,
  preferredDate: r.preferred_date, alternateDate: r.alternate_date, district: r.district,
  village: r.village, notes: r.notes, status: r.status, createdAt: r.created_at,
});

export const serviceLabel = (id: string) => SERVICES.find((s) => s.id === id)?.label ?? id;

/** Human reference, as in the design: SG-1048. Allocated inside the insert's transaction. */
function nextReference(): string {
  db.prepare("INSERT INTO reference_counter (name, value) VALUES ('request', 1047) ON CONFLICT(name) DO NOTHING").run();
  db.prepare("UPDATE reference_counter SET value = value + 1 WHERE name = 'request'").run();
  const row = db.prepare("SELECT value FROM reference_counter WHERE name = 'request'").get() as { value: number };
  return `SG-${row.value}`;
}

export type NewRequest = {
  service: string;
  acres: number;
  preferredDate: string;
  alternateDate: string | null;
  district: string;
  village: string;
  notes: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
};

export function createRequest(farmerId: string | null, input: NewRequest): ServiceRequest {
  const now = new Date().toISOString();
  const id = randomUUID();
  // One transaction, so a reference is never allocated without the request it belongs to.
  // node:sqlite has no transaction() helper, so the statements are explicit.
  db.exec("BEGIN IMMEDIATE");
  let reference: string;
  try {
    reference = nextReference();
    db.prepare(
      `INSERT INTO service_request
        (id, reference, farmer_id, contact_name, contact_phone, contact_email, service, acres,
         preferred_date, alternate_date, district, village, notes, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      id, reference, farmerId, input.contactName, input.contactPhone, input.contactEmail,
      input.service, input.acres, input.preferredDate, input.alternateDate, input.district,
      input.village, input.notes, now, now,
    );
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
  audit(farmerId ?? "guest", "request.created", id, reference);
  return getById(id)!;
}

export function getById(id: string): ServiceRequest | null {
  const r = db.prepare("SELECT * FROM service_request WHERE id = ?").get(id) as Row | undefined;
  return r ? fromRow(r) : null;
}

export function getByReference(reference: string): ServiceRequest | null {
  const r = db.prepare("SELECT * FROM service_request WHERE reference = ?").get(reference) as Row | undefined;
  return r ? fromRow(r) : null;
}

export function listForFarmer(farmerId: string): ServiceRequest[] {
  const rows = db
    .prepare("SELECT * FROM service_request WHERE farmer_id = ? ORDER BY created_at DESC")
    .all(farmerId) as Row[];
  return rows.map(fromRow);
}

/* --------------------------------------------------------- provider browse */

export type Filters = { service?: string; district?: string; window?: string };
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
export function browse(filters: Filters, page: number): { rows: ServiceRequest[]; total: number; pages: number } {
  const where: string[] = ["status <> 'cancelled'"];
  const params: (string | number)[] = [];
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
  const total = Number((db.prepare(`SELECT COUNT(*) AS n FROM service_request ${clause}`).get(...params) as { n: number }).n);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pages);
  const rows = db
    .prepare(`SELECT * FROM service_request ${clause} ORDER BY preferred_date ASC, created_at DESC LIMIT ? OFFSET ?`)
    .all(...params, PAGE_SIZE, (safePage - 1) * PAGE_SIZE) as Row[];
  return { rows: rows.map(fromRow), total, pages };
}

/** A farmer can withdraw their own request while nobody has started work. */
export function cancel(farmerId: string, id: string): boolean {
  const res = db
    .prepare(
      `UPDATE service_request SET status='cancelled', updated_at=?
       WHERE id=? AND farmer_id=? AND status IN ('awaiting_quotes','quotes_sent')`,
    )
    .run(new Date().toISOString(), id, farmerId);
  if (changed(res)) audit(farmerId, "request.cancelled", id);
  return changed(res) > 0;
}
