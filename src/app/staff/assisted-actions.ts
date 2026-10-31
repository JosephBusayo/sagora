"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DISTRICTS, SERVICES } from "@/lib/business";
import type { FormState } from "@/lib/auth-flows";
import { confirmOnBehalf } from "@/lib/jobs";
import { LAND_ACCESS, LAND_CLEARANCE, LAND_CONDITION } from "@/lib/land";
import { notify } from "@/lib/outbox";
import { acceptQuote, getQuote } from "@/lib/quotes";
import { createRequest, getById, logContact, providersCovering } from "@/lib/requests";
import { requireStaff } from "@/lib/session";
import { db } from "@/lib/db";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const today = () => new Date().toISOString().slice(0, 10);
const oneOf = (options: readonly { id: string }[]) => (v: string) => options.some((o) => o.id === v);

const schema = z.object({
  callerName: z.string().min(2, "Enter who called").max(100),
  callerPhone: z.string().min(6, "Enter a number to call back").max(30),
  callerRelation: z.string().min(2, "Say who they are to the farmer").max(100),
  farmerName: z.string().min(2, "Enter the farmer's name").max(100),
  mayAccept: z.string().min(2, "Name who may accept a quote").max(100),
  service: z.string().refine(oneOf(SERVICES), "Choose the work"),
  crop: z.string().max(60),
  acres: z.coerce.number().positive("Enter the size in acres").max(10000, "That looks too large"),
  landAccess: z.string().refine(oneOf(LAND_ACCESS), "Choose the land access"),
  landCondition: z.string().refine((v) => !v || oneOf(LAND_CONDITION)(v), "Choose the land condition"),
  landClearance: z.string().refine(oneOf(LAND_CLEARANCE), "Choose the land clearance"),
  district: z.enum(DISTRICTS, { error: "Choose the district" }),
  village: z.string().min(2, "Enter the village or town").max(100),
  preferredDate: z.string().min(1, "Choose a date").refine((v) => v >= today(), "Choose a date in the future"),
  notes: z.string().max(500),
});

export async function createAssistedAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const values = Object.fromEntries(Object.keys(schema.shape).map((k) => [k, str(fd, k)]));
  const parsed = schema.safeParse(values);
  const fieldErrors: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
  if (values.service === "harvesting" && values.crop.length < 2) fieldErrors.crop = "Say what crop is being harvested";
  if (!parsed.success || Object.keys(fieldErrors).length) return { fieldErrors, values };

  const d = parsed.data;
  const created = await createRequest(null, {
    service: d.service, acres: d.acres, landAccess: d.landAccess, landCondition: d.landCondition, landClearance: d.landClearance,
    crop: d.service === "harvesting" ? d.crop : "", preferredDate: d.preferredDate, alternateDate: null,
    district: d.district, village: d.village, notes: d.notes,
    contactName: d.farmerName, contactPhone: d.callerPhone, contactEmail: "",
    assisted: { by: staff.id, callerName: d.callerName, callerRelation: d.callerRelation, mayAccept: d.mayAccept },
  });
  for (const p of await providersCovering(d)) {
    await notify({
      kind: "request.new",
      dedupeKey: `request.new:${created.id}:${p.businessId}`,
      to: p.email,
      subject: `New request ${created.reference} in ${d.district}`,
      text: `A farmer in ${d.district} is asking for ${d.service} on ${d.acres} acres. Sign in to Sagora to send a quote.`,
    });
  }
  redirect(`/staff/requests/${created.id}`);
}

export async function logContactAction(fd: FormData) {
  const staff = await requireStaff();
  const requestId = str(fd, "requestId");
  const outcome = str(fd, "outcome").slice(0, 400);
  if (outcome.length >= 2 && (await getById(requestId))?.assistedBy) await logContact(staff.id, requestId, outcome);
  revalidatePath(`/staff/requests/${requestId}`);
}

export async function acceptOnBehalfAction(fd: FormData) {
  const staff = await requireStaff();
  const quoteId = str(fd, "quoteId");
  const requestId = str(fd, "requestId");
  const result = await acceptQuote(quoteId, staff.id, true);
  if (!result.ok) redirect(`/staff/requests/${requestId}?error=${encodeURIComponent(result.reason)}`);
  await logContact(staff.id, requestId, "Quote accepted on the farmer's behalf");
  const quote = await getQuote(quoteId);
  const row = await db.get("SELECT email FROM provider_business WHERE id=?", quote?.businessId ?? "") as { email: string } | undefined;
  const request = await getById(requestId);
  if (row?.email && request) {
    await notify({
      kind: "quote.accepted",
      dedupeKey: `quote.accepted:${quoteId}`,
      to: row.email,
      subject: `Your quote for ${request.reference} was accepted`,
      text: `Your quote for ${request.reference} was accepted. The price and terms are fixed at that version.`,
    });
  }
  redirect(`/staff/requests/${requestId}`);
}

export async function confirmOnBehalfAction(fd: FormData) {
  const staff = await requireStaff();
  const requestId = str(fd, "requestId");
  const result = await confirmOnBehalf(staff.id, requestId);
  if (result.ok) await logContact(staff.id, requestId, "Work confirmed on the farmer's behalf");
  revalidatePath(`/staff/requests/${requestId}`);
}
