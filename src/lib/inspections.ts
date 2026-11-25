import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { audit } from "./business";

/**
 * Farm inspections (UC08): the provider goes to look before pricing. The inspection lives on the
 * request it is for, so findings stay next to the request and the quote that follows.
 */

export type InspectionStatus = "required" | "scheduled" | "completed";

export const INSPECTION_LABEL: Record<InspectionStatus, string> = {
  required: "Inspection needed",
  scheduled: "Inspection booked",
  completed: "Inspection done",
};

export type Inspection = {
  id: string; requestId: string; businessId: string; status: InspectionStatus;
  scheduledFor: string; findings: string; openQuestions: string; updatedAt: string;
  /** A day put forward and waiting on the other side. Empty once it is accepted or dropped. */
  proposedFor: string; proposedAt: string;
  /** The time on that day ("09:30"), or empty when only a day was given. */
  proposedTime: string;
  /** Whose suggestion is waiting: the one who did not make it is the one who answers. */
  proposedSide: "farmer" | "provider" | "";
  /** The agreed time on scheduledFor, when one was agreed. */
  scheduledTime: string;
};

type Row = {
  id: string; request_id: string; business_id: string; status: InspectionStatus; scheduled_for: string;
  findings: string; open_questions: string; updated_at: string;
  proposed_for?: string | null; proposed_at?: string | null;
  proposed_time?: string | null; proposed_side?: string | null; scheduled_time?: string | null;
};

const fromRow = (r: Row): Inspection => ({
  id: r.id, requestId: r.request_id, businessId: r.business_id, status: r.status, scheduledFor: r.scheduled_for,
  findings: r.findings, openQuestions: r.open_questions, updatedAt: r.updated_at,
  proposedFor: r.proposed_for ?? "", proposedAt: r.proposed_at ?? "",
  proposedTime: r.proposed_time ?? "",
  proposedSide: r.proposed_side === "farmer" || r.proposed_side === "provider" ? r.proposed_side : "",
  scheduledTime: r.scheduled_time ?? "",
});

export async function inspectionFor(requestId: string, businessId: string): Promise<Inspection | null> {
  const r = await db.get("SELECT * FROM inspection WHERE request_id=? AND business_id=?", requestId, businessId) as Row | undefined;
  return r ? fromRow(r) : null;
}

/** Every provider's inspection of one request, for the farmer and staff. */
export async function inspectionsForRequest(requestId: string): Promise<Inspection[]> {
  const rows = await db.all("SELECT * FROM inspection WHERE request_id=? ORDER BY updated_at DESC", requestId) as Row[];
  return rows.map(fromRow);
}

/** Why this business cannot quote yet, or null when the inspection does not stand in the way. */
export async function inspectionBlocksQuote(requestId: string, businessId: string): Promise<string | null> {
  const i = await inspectionFor(requestId, businessId);
  if (!i) return null;
  if (i.status === "required") return "You said this farm needs an inspection. Book it and record what you find before you send a quote.";
  if (i.status === "scheduled") return "Record what the inspection found before you send a quote.";
  if (i.openQuestions.trim()) return "The inspection still has open questions. Answer them, or clear them, before you send a quote.";
  return null;
}

export type InspectionInput = { status: InspectionStatus | "none"; scheduledFor: string; findings: string; openQuestions: string };

export async function saveInspection(requestId: string, businessId: string, actorId: string, input: InspectionInput): Promise<void> {
  const now = new Date().toISOString();
  if (input.status === "none") {
    const res = await db.run("DELETE FROM inspection WHERE request_id=? AND business_id=?", requestId, businessId);
    if (res.changes) await audit(actorId, "inspection.removed", requestId);
    return;
  }
  await db.run(`INSERT INTO inspection (id, request_id, business_id, status, scheduled_for, findings, open_questions, updated_by, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT (request_id, business_id) DO UPDATE SET status=excluded.status, scheduled_for=excluded.scheduled_for,
         findings=excluded.findings, open_questions=excluded.open_questions, updated_by=excluded.updated_by, updated_at=excluded.updated_at`,
    randomUUID(), requestId, businessId, input.status, input.scheduledFor, input.findings, input.openQuestions, actorId, now, now);
  // Confirming a date answers whatever the farmer put forward, so the proposal stops standing.
  if (input.status !== "required") {
    await db.run("UPDATE inspection SET proposed_for='', proposed_at='', proposed_time='', proposed_side='' WHERE request_id=? AND business_id=?", requestId, businessId);
  }
  await audit(actorId, `inspection.${input.status}`, requestId, input.scheduledFor || undefined);
}

/**
 * The farmer puts a time forward for an inspection of their own farm (Karim, 22 Nov 2026).
 *
 * It is only ever a proposal: the provider has to travel there, so they confirm it, and
 * confirming is what sets the date. Keeping the two apart means nothing the farmer types can
 * read as a booking the provider has not agreed to.
 */
export async function proposeInspectionTime(
  requestId: string, businessId: string, actorId: string, day: string, time: string, side: "farmer" | "provider",
): Promise<boolean> {
  const now = new Date().toISOString();
  const res = await db.run(`UPDATE inspection SET proposed_for=?, proposed_time=?, proposed_side=?, proposed_by=?, proposed_at=?, updated_at=?
       WHERE request_id=? AND business_id=? AND status IN ('required','scheduled')`,
    day, time, side, actorId, now, now, requestId, businessId);
  if (res.changes) await audit(actorId, "inspection.proposed", requestId, `${side}:${day} ${time}`.trim());
  return res.changes > 0;
}

/**
 * Accepts the day the other side put forward, which is the only way a visit becomes booked: the
 * farmer accepts the provider's suggestion, or the provider accepts the farmer's. Returns the
 * booked day and time, or null when there is no suggestion from the other side to accept.
 */
export async function acceptInspectionTime(
  requestId: string, businessId: string, actorId: string, side: "farmer" | "provider",
): Promise<{ day: string; time: string } | null> {
  const other = side === "farmer" ? "provider" : "farmer";
  const i = await inspectionFor(requestId, businessId);
  if (!i || i.status === "completed" || i.proposedSide !== other || !i.proposedFor) return null;
  const now = new Date().toISOString();
  const res = await db.run(`UPDATE inspection SET status='scheduled', scheduled_for=proposed_for, scheduled_time=proposed_time,
         proposed_for='', proposed_time='', proposed_side='', proposed_at='', updated_by=?, updated_at=?
       WHERE request_id=? AND business_id=? AND proposed_side=? AND status IN ('required','scheduled')`,
    actorId, now, requestId, businessId, other);
  if (!res.changes) return null;
  await audit(actorId, "inspection.scheduled", requestId, `${i.proposedFor} ${i.proposedTime}`.trim());
  return { day: i.proposedFor, time: i.proposedTime };
}

/** Every inspection still open, with both sides' contact details, for the coordinators (UC14). */
export type OpenInspection = {
  requestId: string; reference: string; status: InspectionStatus; scheduledFor: string; proposedFor: string;
  updatedAt: string; service: string; district: string; village: string;
  farmerName: string; farmerPhone: string; farmerEmail: string; hasAccount: boolean; assisted: boolean;
  businessId: string; businessName: string; businessPhone: string; businessEmail: string; businessTown: string;
};

export async function openInspections(): Promise<OpenInspection[]> {
  const rows = await db.all(`SELECT i.request_id, i.status, i.scheduled_for, i.proposed_for, i.updated_at, i.business_id,
         r.reference, r.service, r.district, r.village, r.contact_name, r.contact_phone, r.contact_email, r.farmer_id, r.assisted_by,
         b.name AS business_name, b.phone AS business_phone, b.email AS business_email, b.town AS business_town
       FROM inspection i JOIN service_request r ON r.id = i.request_id JOIN provider_business b ON b.id = i.business_id
       WHERE i.status IN ('required','scheduled') AND r.status NOT IN ('cancelled','completed')
       ORDER BY i.updated_at ASC`) as {
    request_id: string; status: InspectionStatus; scheduled_for: string; proposed_for: string | null; updated_at: string; business_id: string;
    reference: string; service: string; district: string; village: string;
    contact_name: string; contact_phone: string; contact_email: string | null; farmer_id: string | null; assisted_by: string | null;
    business_name: string; business_phone: string; business_email: string; business_town: string;
  }[];
  return rows.map((r) => ({
    requestId: r.request_id, reference: r.reference, status: r.status, scheduledFor: r.scheduled_for,
    proposedFor: r.proposed_for ?? "", updatedAt: r.updated_at, service: r.service, district: r.district, village: r.village,
    farmerName: r.contact_name, farmerPhone: r.contact_phone, farmerEmail: r.contact_email ?? "",
    hasAccount: Boolean(r.farmer_id), assisted: Boolean(r.assisted_by),
    businessId: r.business_id, businessName: r.business_name, businessPhone: r.business_phone,
    businessEmail: r.business_email, businessTown: r.business_town,
  }));
}
