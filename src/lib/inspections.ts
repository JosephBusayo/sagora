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
};

type Row = {
  id: string; request_id: string; business_id: string; status: InspectionStatus; scheduled_for: string;
  findings: string; open_questions: string; updated_at: string;
};

const fromRow = (r: Row): Inspection => ({
  id: r.id, requestId: r.request_id, businessId: r.business_id, status: r.status, scheduledFor: r.scheduled_for,
  findings: r.findings, openQuestions: r.open_questions, updatedAt: r.updated_at,
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
  await audit(actorId, `inspection.${input.status}`, requestId, input.scheduledFor || undefined);
}
