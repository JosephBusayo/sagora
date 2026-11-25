import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { activeServices } from "./catalogue";

export const DISTRICTS = [
  "Bo", "Bombali", "Bonthe", "Falaba", "Kailahun", "Kambia", "Karene", "Kenema",
  "Koinadugu", "Kono", "Moyamba", "Port Loko", "Pujehun", "Tonkolili",
  "Western Area Rural", "Western Area Urban",
] as const;

/**
 * The districts Sagora actually operates in today.
 *
 * Joseph, 25 Nov 2026: the pilot runs in three districts, and neither a farmer nor a provider may
 * choose outside them. All sixteen stay in DISTRICTS above, because rows written before this —
 * a request in Bo, a provider's office in Kenema — still have to render their own district by
 * name. The two lists answer different questions: DISTRICTS is "what is a district", this is
 * "where may new work be asked for or offered".
 *
 * In the order Joseph gave them, which is not alphabetical and is not accidental.
 */
export const OPERATING_DISTRICTS = ["Bombali", "Tonkolili", "Port Loko"] as const;

export const isOperatingDistrict = (d: string) => (OPERATING_DISTRICTS as readonly string[]).includes(d);

/**
 * The districts to offer on a form that may be editing something older than this rule.
 *
 * A request raised in Bo before the pilot narrowed to three districts still has to be editable
 * without its district silently changing to one of the three, so the one it already has is kept
 * in the list. New work gets the three and nothing else.
 */
export const districtChoicesFor = (current?: string | null): readonly string[] =>
  current && !isOperatingDistrict(current)
    ? [...OPERATING_DISTRICTS, current]
    : OPERATING_DISTRICTS;

/**
 * What a farmer may ask for and a provider may cover: the active half of the catalogue.
 *
 * The full list of twenty lives in lib/catalogue.ts, which is pure data so the forms can read it
 * too. Only the switched-on ones appear here, because "keep services outside the approved
 * deployment inactive" — every existing consumer of SERVICES is a form, a filter or a validator,
 * and none of them should offer work Sagora has not agreed to sell.
 */
export const SERVICES: readonly { id: string; label: string }[] =
  activeServices().map((s) => ({ id: s.id, label: s.label }));

/** The design writes "Bombali District". The two Western Area names already read as places. */
export const districtLabel = (d: string) => (d.startsWith("Western Area") ? d : `${d} District`);

/** UC02: who the provider is in law, which decides the papers Sagora asks for. */
export const BUSINESS_TYPES = [
  { id: "individual", label: "Individual owner" },
  { id: "cooperative", label: "Cooperative or farmer group" },
  { id: "company", label: "Registered company" },
] as const;

/** How the provider prices work. The quote itself is still a total; this tells farmers and reviewers how it is worked out. */
export const PRICING_BASES = [
  { id: "per_acre", label: "Per acre" },
  { id: "per_hectare", label: "Per hectare" },
  { id: "per_day", label: "Per day" },
  { id: "per_job", label: "Per job" },
] as const;

export const optionLabel = (options: readonly { id: string; label: string }[], id: string) => options.find((o) => o.id === id)?.label ?? "Not given";

export type BusinessStatus = "draft" | "submitted" | "changes_requested" | "approved" | "rejected";

export type Business = {
  id: string;
  userId: string;
  name: string;
  phone: string;
  email: string;
  /** The district the office is in. An address, not a service area — see operatingDistricts. */
  district: string;
  town: string;
  /** Street, landmark or plot: the rest of the official office address. */
  officeAddress: string;
  /** Where this business offers to work. The only location matching reads. */
  operatingDistricts: string[];
  services: string[];
  description: string;
  businessType: string;
  authorisedName: string;
  authorisedRole: string;
  pricingBasis: string;
  includedCosts: string;
  depositTerms: string;
  cancellationTerms: string;
  status: BusinessStatus;
  reviewNote: string;
  submittedAt: string | null;
  reviewedAt: string | null;
};

type Row = {
  id: string; user_id: string; name: string; phone: string; email: string; district: string; town: string;
  services: string; description: string; status: BusinessStatus; review_note: string;
  office_address?: string; operating_districts?: string;
  business_type?: string; authorised_name?: string; authorised_role?: string; pricing_basis?: string;
  included_costs?: string; deposit_terms?: string; cancellation_terms?: string;
  submitted_at: string | null; reviewed_at: string | null;
};

/** A JSON array column read back defensively: a row written before the column existed reads as []. */
function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function fromRow(r: Row): Business {
  return {
    id: r.id, userId: r.user_id, name: r.name, phone: r.phone, email: r.email, district: r.district, town: r.town,
    officeAddress: r.office_address ?? "",
    operatingDistricts: parseList(r.operating_districts),
    services: JSON.parse(r.services) as string[], description: r.description, status: r.status,
    businessType: r.business_type ?? "", authorisedName: r.authorised_name ?? "", authorisedRole: r.authorised_role ?? "",
    pricingBasis: r.pricing_basis ?? "", includedCosts: r.included_costs ?? "", depositTerms: r.deposit_terms ?? "",
    cancellationTerms: r.cancellation_terms ?? "",
    reviewNote: r.review_note, submittedAt: r.submitted_at, reviewedAt: r.reviewed_at,
  };
}

export async function audit(actorId: string, action: string, entityId: string, detail = "") {
  // The id comes from here rather than from the database, so the same schema works on SQLite
  // and on Postgres without one of them needing AUTOINCREMENT and the other SERIAL.
  await db.run("INSERT INTO audit_log (id, at, actor_id, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?,?)", randomUUID(), new Date().toISOString(), actorId, action, "provider_business", entityId, detail,);
}

/** The business belonging to this signed-in provider. Always looked up by session user, never by a form value. */
export async function getBusinessForUser(userId: string): Promise<Business | null> {
  const r = await db.get("SELECT * FROM provider_business WHERE user_id = ?", userId) as Row | undefined;
  return r ? fromRow(r) : null;
}

/** A business a farmer may be sent to directly. */
export async function getApprovedBusiness(id: string): Promise<Business | null> {
  const r = await db.get("SELECT * FROM provider_business WHERE id = ? AND status = 'approved'", id) as Row | undefined;
  return r ? fromRow(r) : null;
}

/** Creates the draft the first time, pre-filled from the sign-up details. */
export async function ensureBusiness(user: { id: string; name: string; email: string; phone?: string | null; businessName?: string | null }): Promise<Business> {
  const existing = await getBusinessForUser(user.id);
  if (existing) return existing;
  const now = new Date().toISOString();
  const id = randomUUID();
  await db.run("INSERT INTO provider_business (id, user_id, name, phone, email, created_at, updated_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING", id, user.id, user.businessName ?? user.name, user.phone ?? "", user.email, now, now);
  return (await getBusinessForUser(user.id))!;
}

export type BusinessInput = Pick<Business, "name" | "phone" | "email" | "district" | "town" | "officeAddress"
  | "operatingDistricts" | "services" | "description"
  | "businessType" | "authorisedName" | "authorisedRole" | "pricingBasis" | "includedCosts" | "depositTerms" | "cancellationTerms">;

/** Only a draft or a "changes requested" business can be edited. Returns false if it is locked. */
export async function saveBusiness(userId: string, input: BusinessInput, submit: boolean): Promise<boolean> {
  const now = new Date().toISOString();
  const res = await db.run(`UPDATE provider_business
         SET name=?, phone=?, email=?, district=?, town=?, office_address=?, operating_districts=?,
             services=?, description=?, updated_at=?,
             business_type=?, authorised_name=?, authorised_role=?, pricing_basis=?, included_costs=?, deposit_terms=?, cancellation_terms=?,
             status = CASE WHEN ? = 1 THEN 'submitted' ELSE status END,
             submitted_at = CASE WHEN ? = 1 THEN ? ELSE submitted_at END,
             review_note = CASE WHEN ? = 1 THEN '' ELSE review_note END
       WHERE user_id=? AND status IN ('draft','changes_requested')`, input.name, input.phone, input.email, input.district, input.town,
      input.officeAddress, JSON.stringify(input.operatingDistricts.filter(isOperatingDistrict)),
      JSON.stringify(input.services), input.description, now,
      input.businessType, input.authorisedName, input.authorisedRole, input.pricingBasis, input.includedCosts, input.depositTerms, input.cancellationTerms,
      submit ? 1 : 0, submit ? 1 : 0, now, submit ? 1 : 0, userId,);
  if (res.changes === 0) return false;
  const b = (await getBusinessForUser(userId))!;
  await audit(userId, submit ? "business.submitted" : "business.draft_saved", b.id);
  return true;
}

/* ------------------------------------------------------------ staff review */

export async function listForReview(): Promise<(Business & { ownerEmail: string })[]> {
  const rows = await db.all(`SELECT b.*, u.email AS owner_email FROM provider_business b JOIN "user" u ON u.id = b.user_id
       WHERE b.status = 'submitted' ORDER BY b.submitted_at ASC`,) as (Row & { owner_email: string })[];
  return rows.map((r) => ({ ...fromRow(r), ownerEmail: r.owner_email }));
}

export type Decision = "approved" | "changes_requested" | "rejected";

/** Moves a submitted business to a decision. Only a submitted business can be decided, so a double click does nothing. */
export async function decide(businessId: string, staffId: string, decision: Decision, note: string): Promise<Business | null> {
  const now = new Date().toISOString();
  const res = await db.run(`UPDATE provider_business SET status=?, review_note=?, reviewed_at=?, reviewed_by=?, updated_at=?
       WHERE id=? AND status='submitted'`, decision, note, now, staffId, now, businessId);
  if (res.changes === 0) return null;
  await audit(staffId, `business.${decision}`, businessId, note);
  const r = await db.get("SELECT * FROM provider_business WHERE id = ?", businessId) as Row;
  const b = fromRow(r);
  // The district and services from setup are where requests start coming from.
  if (decision === "approved") await (await import("./coverage")).activateHome(b, staffId);
  return b;
}
