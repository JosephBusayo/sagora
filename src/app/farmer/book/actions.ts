"use server";

import { flash } from "@/lib/flash";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DISTRICTS, SERVICES, districtLabel, getApprovedBusiness } from "@/lib/business";
import { coversWork, createRequest, providersCovering, serviceLabel, updateRequest } from "@/lib/requests";
import { requireFarmer } from "@/lib/session";
import { notify } from "@/lib/outbox";
import { LAND_ACCESS, LAND_CLEARANCE, LAND_CONDITION } from "@/lib/land";
import { normaliseSierraLeonePhone } from "@/lib/phone";
import type { FormState } from "@/lib/auth-flows";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).trim() : "");
const serviceIds = SERVICES.map((s) => s.id) as string[];
const today = () => new Date().toISOString().slice(0, 10);

const ids = (options: readonly { id: string }[]) => options.map((o) => o.id) as string[];

/** The first step, on its own so "Continue" can check it before showing the second. */
const land = z.object({
  service: z.string().refine((v) => serviceIds.includes(v), "Choose the work you need"),
  acres: z.coerce.number().positive("Enter the size in acres").max(10000, "That looks too large"),
  landAccess: z.string().refine((v) => ids(LAND_ACCESS).includes(v), "Choose the land access"),
  // The design marks this one optional.
  landCondition: z.string().refine((v) => !v || ids(LAND_CONDITION).includes(v), "Choose the land condition"),
  landClearance: z.string().refine((v) => ids(LAND_CLEARANCE).includes(v), "Choose the land clearance"),
  crop: z.string().max(60, "Use 60 characters or fewer"),
  notes: z.string().max(500, "Use 500 characters or fewer"),
});

const schema = land.extend({
  preferredDate: z.string().min(1, "Choose a date").refine((v) => v >= today(), "Choose a date in the future"),
  alternateDate: z.string(),
  district: z.enum(DISTRICTS, { error: "Choose your district" }),
  village: z.string().min(2, "Enter your community or village").max(100, "Use 100 characters or fewer"),
});

export type BookState = FormState & { step?: 1 | 2 };

export async function bookService(_prev: BookState, fd: FormData): Promise<BookState> {
  const farmer = await requireFarmer();
  const raw = {
    service: str(fd, "service"),
    acres: str(fd, "acres"),
    landAccess: str(fd, "landAccess"),
    landCondition: str(fd, "landCondition"),
    landClearance: str(fd, "landClearance"),
    crop: str(fd, "crop"),
    preferredDate: str(fd, "preferredDate"),
    alternateDate: str(fd, "alternateDate"),
    district: str(fd, "district"),
    village: str(fd, "village"),
    notes: str(fd, "notes"),
  };
  const values = { ...raw };

  // Checked again on the final submit: the hidden fields can be edited like any other.
  const first = land.safeParse(raw);
  if (!first.success) {
    const errors: Record<string, string> = {};
    for (const i of first.error.issues) errors[String(i.path[0])] ??= i.message;
    return { step: 1, fieldErrors: errors, values };
  }
  if (raw.service === "harvesting" && raw.crop.length < 2) {
    return { step: 1, fieldErrors: { crop: "Say what crop is being harvested" }, values };
  }
  if (str(fd, "step") !== "2") return { step: 2, values };

  const parsed = schema.safeParse(raw);
  const fieldErrors: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
  if (raw.alternateDate && raw.alternateDate < raw.preferredDate) {
    fieldErrors.alternateDate = "The latest start date must be on or after the preferred start date";
  }
  if (!parsed.success || Object.keys(fieldErrors).length) return { step: 2, fieldErrors, values };

  // A direct request stays with the chosen provider, so one that cannot do the work is refused,
  // never quietly opened up to everyone else.
  const directTo = str(fd, "directTo");
  const chosen = directTo ? await getApprovedBusiness(directTo) : null;
  if (directTo && (!chosen || !coversWork(chosen, parsed.data))) {
    const what = `${serviceLabel(parsed.data.service).toLowerCase()} in ${districtLabel(parsed.data.district)}`;
    return { step: 2, fieldErrors: { district: `${chosen?.name ?? "That provider"} does not offer ${what}.` }, values };
  }

  const d = parsed.data;
  const details = {
    service: d.service,
    acres: d.acres,
    landAccess: d.landAccess,
    landCondition: d.landCondition,
    landClearance: d.landClearance,
    crop: d.service === "harvesting" ? d.crop : "",
    preferredDate: d.preferredDate,
    alternateDate: d.alternateDate || null,
    district: d.district,
    village: d.village,
    notes: d.notes,
  };

  const requestId = str(fd, "requestId");
  if (requestId) {
    const saved = await updateRequest(farmer.id, requestId, details);
    if (!saved) return { step: 2, values, error: "This request can no longer be edited: a provider has quoted it." };
    redirect(`/farmer/requests/${requestId}`);
  }

  const created = await createRequest(farmer.id, {
    ...details,
    directTo: chosen?.id ?? null,
    contactName: farmer.name,
    contactPhone: normaliseSierraLeonePhone(farmer.phone ?? "") ?? (farmer.phone ?? ""),
    contactEmail: farmer.email,
  });

  // The reference is the farmer's way back to this request, so it goes out by email too.
  // TODO (stage 2): write to an outbox first and retry, so an email outage never loses it.
  await notify({
    kind: "request.created",
    dedupeKey: `request.created:${created.id}`,
    to: farmer.email,
    subject: `Your Sagora request ${created.reference}`,
    text:
      `We have your request for ${d.service} on ${d.acres} acres in ${d.village}, ${d.district}.\n\n` +
      `Your reference is ${created.reference}. Keep it: it is how you find this request again.\n\n` +
      `A request is not a booking. Providers will send you quotes, and nothing is confirmed ` +
      `until you accept one and pay.`,
  });

  // Only the work itself: a provider gets no farmer's name or number from this.
  const covering = await providersCovering(d);
  for (const p of chosen ? covering.filter((c) => c.businessId === chosen.id) : covering) {
    await notify({
      kind: "request.new",
      dedupeKey: `request.new:${created.id}:${p.businessId}`,
      to: p.email,
      subject: `New request ${created.reference} in ${d.district}`,
      text: `A farmer in ${d.district} is asking for ${d.service} on ${d.acres} acres. Sign in to Sagora to send a quote.`,
    });
  }

  (await cookies()).delete("sagora_direct");
  redirect(`/farmer/requests?new=${created.reference}`);
}

export async function cancelRequest(fd: FormData) {
  const farmer = await requireFarmer();
  const { cancel } = await import("@/lib/requests");
  await cancel(farmer.id, String(fd.get("id") ?? ""));
  await flash("Request withdrawn.");
  redirect("/farmer/requests");
}
