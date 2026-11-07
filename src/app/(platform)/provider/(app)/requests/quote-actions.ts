"use server";

import { flash } from "@/lib/flash";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/guard";
import { parseAmount, formatAmount } from "@/lib/money";
import { sendQuote, withdrawQuote } from "@/lib/quotes";
import { covers, getById } from "@/lib/requests";
import { notify } from "@/lib/outbox";
import { db } from "@/lib/db";
import { inspectionBlocksQuote, saveInspection, type InspectionInput } from "@/lib/inspections";
import type { FormState } from "@/lib/auth-flows";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).trim() : "");
const today = () => new Date().toISOString().slice(0, 10);

export async function sendQuoteAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return { error: "You do not have permission to send quotes." };

  const requestId = str(fd, "requestId");
  const raw = {
    amount: str(fd, "amount"),
    includes: str(fd, "includes"),
    startDate: str(fd, "startDate"),
    validUntil: str(fd, "validUntil"),
    note: str(fd, "note"),
  };
  const values = { ...raw };

  const fieldErrors: Record<string, string> = {};
  const amountMinor = parseAmount(raw.amount);
  if (amountMinor === null) fieldErrors.amount = "Enter the total price, for example 1,500.00";
  if (raw.includes.length < 3) fieldErrors.includes = "Say what the price covers";
  if (raw.includes.length > 300) fieldErrors.includes = "Use 300 characters or fewer";
  if (!raw.startDate) fieldErrors.startDate = "Choose the day you can start";
  else if (raw.startDate < today()) fieldErrors.startDate = "Choose a date in the future";
  if (!raw.validUntil) fieldErrors.validUntil = "Say how long this price holds";
  else if (raw.validUntil < today()) fieldErrors.validUntil = "Choose a date in the future";
  else if (raw.startDate && raw.validUntil > raw.startDate) {
    fieldErrors.validUntil = "The price must hold until the start date at the latest";
  }
  if (raw.note.length > 500) fieldErrors.note = "Use 500 characters or fewer";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  // The list only shows what a business covers. This stops a form posted by hand.
  const target = await getById(requestId);
  if (!target || !covers(business, target)) return { error: "This request is outside your district or services.", values };

  const blocked = await inspectionBlocksQuote(requestId, business.id);
  if (blocked) return { error: blocked, values };

  const result = await sendQuote(requestId, business.id, user.id, {
    amountMinor: amountMinor!,
    includes: raw.includes,
    startDate: raw.startDate,
    validUntil: raw.validUntil,
    note: raw.note,
  });
  if (!result.ok) return { error: result.reason, values };

  const request = await getById(requestId);
  if (request?.contactEmail) {
    const isRevision = result.quote.version > 1;
    await notify({
      kind: isRevision ? "quote.revised" : "quote.sent",
      dedupeKey: `quote:${result.quote.id}`,
      to: request.contactEmail,
      subject: `${isRevision ? "Updated quote" : "New quote"} for ${request.reference}`,
      text:
        `${business.name} ${isRevision ? "has updated their quote" : "has quoted"} for your ${request.service} request ${request.reference}.\n\n` +
        `Price: ${formatAmount(result.quote.amountMinor)}\nCovers: ${result.quote.includes}\n` +
        `Can start: ${result.quote.startDate}\nPrice holds until: ${result.quote.validUntil}\n\n` +
        `Sign in to compare quotes and accept one. Accepting agrees the price; it is not a booking ` +
        `until payment is arranged.`,
    });
  }

  revalidatePath("/provider/requests");
  revalidatePath("/provider/quotes");
  return { notice: result.quote.version > 1 ? `Quote updated (version ${result.quote.version}).` : "Quote sent to the farmer." };
}

/** UC08: the provider's inspection of one farm, kept on the request. */
export async function saveInspectionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return { error: "You do not have permission to change this request." };
  const requestId = str(fd, "requestId");
  const target = await getById(requestId);
  if (!target || !covers(business, target)) return { error: "This request is outside your district or services." };
  const status = str(fd, "status");
  if (!["none", "required", "scheduled", "completed"].includes(status)) return { error: "Choose whether an inspection is needed." };
  const input: InspectionInput = {
    status: status as InspectionInput["status"],
    scheduledFor: status === "scheduled" || status === "completed" ? str(fd, "scheduledFor") : "",
    findings: status === "completed" ? str(fd, "findings") : "",
    openQuestions: status === "completed" ? str(fd, "openQuestions") : "",
  };
  const values = { status, scheduledFor: input.scheduledFor, findings: input.findings, openQuestions: input.openQuestions };
  const fieldErrors: Record<string, string> = {};
  if ((status === "scheduled" || status === "completed") && !/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledFor)) {
    fieldErrors.scheduledFor = status === "completed" ? "Say when you inspected the farm" : "Choose the inspection date";
  } else if (status === "scheduled" && input.scheduledFor < today()) fieldErrors.scheduledFor = "Choose a date in the future";
  else if (status === "completed" && input.scheduledFor > today()) fieldErrors.scheduledFor = "An inspection that is done cannot be in the future";
  if (status === "completed" && input.findings.length < 3) fieldErrors.findings = "Say what you found";
  if (input.findings.length > 500 || input.openQuestions.length > 500) fieldErrors.findings ??= "Use 500 characters or fewer";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };
  await saveInspection(requestId, business.id, user.id, input);
  revalidatePath("/provider/requests");
  return { notice: status === "none" ? "No inspection needed." : "Inspection saved.", values };
}

export async function withdrawQuoteAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return;
  await withdrawQuote(String(fd.get("requestId") ?? ""), business.id, user.id);
  await flash("Quote withdrawn.");
  revalidatePath("/provider/quotes");
  revalidatePath("/provider/requests");
}

/** Used by the modal to show this business's existing quote without exposing other providers'. */
export async function myQuoteFor(requestId: string) {
  const { business } = await requireWorkspace();
  const row = await db.get("SELECT * FROM quote WHERE request_id=? AND business_id=? ORDER BY version DESC LIMIT 1", requestId, business.id) as { amount_minor: number; includes: string; start_date: string; valid_until: string; note: string; status: string; version: number } | undefined;
  return row ?? null;
}
