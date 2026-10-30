"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { DISTRICTS, SERVICES } from "@/lib/business";
import { createRequest, updateRequest } from "@/lib/requests";
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
  if (str(fd, "step") !== "2") return { step: 2, values };

  const parsed = schema.safeParse(raw);
  const fieldErrors: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
  if (raw.alternateDate && raw.alternateDate < raw.preferredDate) {
    fieldErrors.alternateDate = "The latest start date must be on or after the preferred start date";
  }
  if (!parsed.success || Object.keys(fieldErrors).length) return { step: 2, fieldErrors, values };

  const d = parsed.data;
  const details = {
    service: d.service,
    acres: d.acres,
    landAccess: d.landAccess,
    landCondition: d.landCondition,
    landClearance: d.landClearance,
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

  redirect(`/farmer/requests?new=${created.reference}`);
}

export async function cancelRequest(fd: FormData) {
  const farmer = await requireFarmer();
  const { cancel } = await import("@/lib/requests");
  await cancel(farmer.id, String(fd.get("id") ?? ""));
  redirect("/farmer/requests");
}
