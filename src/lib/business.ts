import "server-only";
import { randomUUID } from "node:crypto";
import { changed, db } from "./db";

export const DISTRICTS = [
  "Bo", "Bombali", "Bonthe", "Falaba", "Kailahun", "Kambia", "Karene", "Kenema",
  "Koinadugu", "Kono", "Moyamba", "Port Loko", "Pujehun", "Tonkolili",
  "Western Area Rural", "Western Area Urban",
] as const;

export const SERVICES = [
  { id: "ploughing", label: "Ploughing" },
  { id: "harvesting", label: "Harvesting" },
] as const;

export type BusinessStatus = "draft" | "submitted" | "changes_requested" | "approved" | "rejected";

export type Business = {
  id: string;
  userId: string;
  name: string;
  phone: string;
  email: string;
  district: string;
  town: string;
  services: string[];
  description: string;
  status: BusinessStatus;
  reviewNote: string;
  submittedAt: string | null;
  reviewedAt: string | null;
};

type Row = {
  id: string; user_id: string; name: string; phone: string; email: string; district: string; town: string;
  services: string; description: string; status: BusinessStatus; review_note: string;
  submitted_at: string | null; reviewed_at: string | null;
};

function fromRow(r: Row): Business {
  return {
    id: r.id, userId: r.user_id, name: r.name, phone: r.phone, email: r.email, district: r.district, town: r.town,
    services: JSON.parse(r.services) as string[], description: r.description, status: r.status,
    reviewNote: r.review_note, submittedAt: r.submitted_at, reviewedAt: r.reviewed_at,
  };
}

export function audit(actorId: string, action: string, entityId: string, detail = "") {
  db.prepare("INSERT INTO audit_log (at, actor_id, action, entity, entity_id, detail) VALUES (?,?,?,?,?,?)").run(
    new Date().toISOString(), actorId, action, "provider_business", entityId, detail,
  );
}

/** The business belonging to this signed-in provider. Always looked up by session user, never by a form value. */
export function getBusinessForUser(userId: string): Business | null {
  const r = db.prepare("SELECT * FROM provider_business WHERE user_id = ?").get(userId) as Row | undefined;
  return r ? fromRow(r) : null;
}

/** Creates the draft the first time, pre-filled from the sign-up details. */
export function ensureBusiness(user: { id: string; name: string; email: string; phone?: string | null; businessName?: string | null }): Business {
  const existing = getBusinessForUser(user.id);
  if (existing) return existing;
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    "INSERT OR IGNORE INTO provider_business (id, user_id, name, phone, email, created_at, updated_at) VALUES (?,?,?,?,?,?,?)",
  ).run(id, user.id, user.businessName ?? user.name, user.phone ?? "", user.email, now, now);
  return getBusinessForUser(user.id)!;
}

export type BusinessInput = Pick<Business, "name" | "phone" | "email" | "district" | "town" | "services" | "description">;

/** Only a draft or a "changes requested" business can be edited. Returns false if it is locked. */
export function saveBusiness(userId: string, input: BusinessInput, submit: boolean): boolean {
  const now = new Date().toISOString();
  const res = db
    .prepare(
      `UPDATE provider_business
         SET name=?, phone=?, email=?, district=?, town=?, services=?, description=?, updated_at=?,
             status = CASE WHEN ? THEN 'submitted' ELSE status END,
             submitted_at = CASE WHEN ? THEN ? ELSE submitted_at END,
             review_note = CASE WHEN ? THEN '' ELSE review_note END
       WHERE user_id=? AND status IN ('draft','changes_requested')`,
    )
    .run(
      input.name, input.phone, input.email, input.district, input.town, JSON.stringify(input.services), input.description, now,
      submit ? 1 : 0, submit ? 1 : 0, now, submit ? 1 : 0, userId,
    );
  if (changed(res) === 0) return false;
  const b = getBusinessForUser(userId)!;
  audit(userId, submit ? "business.submitted" : "business.draft_saved", b.id);
  return true;
}

/* ------------------------------------------------------------ staff review */

export function listForReview(): (Business & { ownerEmail: string })[] {
  const rows = db
    .prepare(
      `SELECT b.*, u.email AS owner_email FROM provider_business b JOIN user u ON u.id = b.user_id
       WHERE b.status = 'submitted' ORDER BY b.submitted_at ASC`,
    )
    .all() as (Row & { owner_email: string })[];
  return rows.map((r) => ({ ...fromRow(r), ownerEmail: r.owner_email }));
}

export type Decision = "approved" | "changes_requested" | "rejected";

/** Moves a submitted business to a decision. Only a submitted business can be decided, so a double click does nothing. */
export function decide(businessId: string, staffId: string, decision: Decision, note: string): Business | null {
  const now = new Date().toISOString();
  const res = db
    .prepare(
      `UPDATE provider_business SET status=?, review_note=?, reviewed_at=?, reviewed_by=?, updated_at=?
       WHERE id=? AND status='submitted'`,
    )
    .run(decision, note, now, staffId, now, businessId);
  if (changed(res) === 0) return null;
  audit(staffId, `business.${decision}`, businessId, note);
  const r = db.prepare("SELECT * FROM provider_business WHERE id = ?").get(businessId) as Row;
  return fromRow(r);
}
