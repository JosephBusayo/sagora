"use server";

import { flash } from "@/lib/flash";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { DISTRICTS, SERVICES, districtLabel, getApprovedBusiness } from "@/lib/business";
import { createRequest, providersCovering, serviceLabel, updateRequest } from "@/lib/requests";
import { coverageOf, inAreas } from "@/lib/coverage";
import { requireFarmer, type SessionUser } from "@/lib/session";
import { guestRequestId, issueTrackingCode, rememberGuest, showCodeOnce } from "@/lib/guest";
import { db } from "@/lib/db";
import { siteUrl } from "@/lib/site";
import { guestActor } from "@/lib/requests";
import { notify } from "@/lib/outbox";
import { CROP_READINESS, LAND_ACCESS, LAND_CLEARANCE, LAND_CONDITION, LAND_TYPE, asksHarvestDetails, cropMissing, needsCrop } from "@/lib/land";
import { normaliseSierraLeonePhone } from "@/lib/phone";
import { chiefdomFits, placeLine } from "@/lib/chiefdoms";
import type { FormState } from "@/lib/auth-flows";
import { landSize, landUnit, toAcres } from "@/lib/land-size";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).trim() : "");
const serviceIds = SERVICES.map((s) => s.id) as string[];
const today = () => new Date().toISOString().slice(0, 10);

const ids = (options: readonly { id: string }[]) => options.map((o) => o.id) as string[];

/** The first step, on its own so "Continue" can check it before showing the second. */
const land = z.object({
  service: z.string().refine((v) => serviceIds.includes(v), "Choose the work you need"),
  acres: z.coerce.number().positive("Enter the land size").max(10000, "That looks too large"),
  landAccess: z.string().refine((v) => ids(LAND_ACCESS).includes(v), "Choose the land access"),
  // The design marks this one optional.
  landCondition: z.string().refine((v) => !v || ids(LAND_CONDITION).includes(v), "Choose the land condition"),
  landClearance: z.string().refine((v) => ids(LAND_CLEARANCE).includes(v), "Choose the land clearance"),
  crop: z.string().max(60, "Use 60 characters or fewer"),
  landType: z.string().refine((v) => !v || ids(LAND_TYPE).includes(v), "Choose upland, lowland or Not sure"),
  cropVariety: z.string().max(60, "Use 60 characters or fewer"),
  plantedOn: z.string().refine((v) => !v || (/^\d{4}-\d{2}-\d{2}$/.test(v) && v <= today()), "The planting date cannot be in the future"),
  cropReadiness: z.string().refine((v) => !v || ids(CROP_READINESS).includes(v), "Choose how ready the crop is"),
  notes: z.string().max(500, "Use 500 characters or fewer"),
});

const schema = land.extend({
  preferredDate: z.string().min(1, "Choose a date").refine((v) => v >= today(), "Choose a date in the future"),
  alternateDate: z.string(),
  district: z.enum(DISTRICTS, { error: "Choose your district" }),
  village: z.string().min(2, "Enter your community or village").max(100, "Use 100 characters or fewer"),
});

/** 1: the land, 2: where and when, 3: the summary to check before it is sent. */
export type BookState = FormState & { step?: 1 | 2 | 3 };

const emailOk = z.email();

/** A signed-in farmer, or someone sending a request without an account. */
type Who = { farmer: SessionUser } | { guest: true };

export async function bookService(_prev: BookState, fd: FormData): Promise<BookState> {
  return book(fd, { farmer: await requireFarmer() });
}

/** The same form for someone with no account. They also give a name and number, and get a tracking code. */
export async function bookAsGuest(_prev: BookState, fd: FormData): Promise<BookState> {
  return book(fd, { guest: true });
}

async function book(fd: FormData, who: Who): Promise<BookState> {
  const farmer = "farmer" in who ? who.farmer : null;
  const contact: Record<string, string> = farmer ? {} : {
    contactName: str(fd, "contactName"),
    contactPhone: str(fd, "contactPhone"),
    contactEmail: str(fd, "contactEmail").toLowerCase(),
  };
  const raw = {
    service: str(fd, "service"),
    acres: str(fd, "acres"),
    unit: landUnit(str(fd, "unit")),
    landAccess: str(fd, "landAccess"),
    landCondition: str(fd, "landCondition"),
    landClearance: str(fd, "landClearance"),
    crop: str(fd, "crop"),
    landType: str(fd, "landType"),
    cropVariety: str(fd, "cropVariety"),
    plantedOn: str(fd, "plantedOn"),
    cropReadiness: str(fd, "cropReadiness"),
    preferredDate: str(fd, "preferredDate"),
    alternateDate: str(fd, "alternateDate"),
    district: str(fd, "district"),
    chiefdom: str(fd, "chiefdom"),
    village: str(fd, "village"),
    notes: str(fd, "notes"),
  };
  const values: Record<string, string> = { ...raw, ...contact };
  // "Edit details" on the summary goes back to the start with every answer kept.
  if (str(fd, "back") === "1") return { step: 1, values };

  // Checked again on the final submit: the hidden fields can be edited like any other.
  const first = land.safeParse(raw);
  if (!first.success) {
    const errors: Record<string, string> = {};
    for (const i of first.error.issues) errors[String(i.path[0])] ??= i.message;
    return { step: 1, fieldErrors: errors, values };
  }
  if (needsCrop(raw.service) && raw.crop.length < 2) {
    return { step: 1, fieldErrors: { crop: cropMissing(raw.service) }, values };
  }
  if (asksHarvestDetails(raw.service) && !raw.cropReadiness) {
    return { step: 1, fieldErrors: { cropReadiness: "Say how ready the crop is, or choose Not sure" }, values };
  }
  if (str(fd, "step") === "1" || !str(fd, "step")) return { step: 2, values };

  const parsed = schema.safeParse(raw);
  const fieldErrors: Record<string, string> = {};
  if (!parsed.success) for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
  if (raw.alternateDate && raw.alternateDate < raw.preferredDate) {
    fieldErrors.alternateDate = "The latest start date must be on or after the preferred start date";
  }
  if (!fieldErrors.district && !chiefdomFits(raw.district, raw.chiefdom)) fieldErrors.chiefdom = "Choose your chiefdom";
  if (!farmer) {
    if ((contact.contactName ?? "").length < 2) fieldErrors.contactName = "Enter your name";
    else if ((contact.contactName ?? "").length > 80) fieldErrors.contactName = "Use 80 characters or fewer";
    if (!normaliseSierraLeonePhone(contact.contactPhone ?? "")) fieldErrors.contactPhone = "Enter a valid Sierra Leone number, for example 76 123 456";
    if (contact.contactEmail && !emailOk.safeParse(contact.contactEmail).success) fieldErrors.contactEmail = "Enter a valid email address, or leave it empty";
  }
  if (!parsed.success || Object.keys(fieldErrors).length) return { step: 2, fieldErrors, values };

  // A direct request stays with the chosen provider, so one that cannot do the work is refused,
  // never quietly opened up to everyone else.
  const directTo = str(fd, "directTo");
  const chosen = directTo ? await getApprovedBusiness(directTo) : null;
  if (directTo && (!chosen || !inAreas((await coverageOf(chosen)).areas, parsed.data))) {
    const what = `${serviceLabel(parsed.data.service).toLowerCase()} in ${districtLabel(parsed.data.district)}`;
    return { step: 2, fieldErrors: { district: `${chosen?.name ?? "That provider"} does not offer ${what}.` }, values };
  }
  // Everything checks out: show it all once more before anything is saved or sent.
  if (str(fd, "step") !== "3") return { step: 3, values };

  const d = parsed.data;
  const details = {
    service: d.service,
    acres: toAcres(d.acres, raw.unit),
    landAccess: d.landAccess,
    landCondition: d.landCondition,
    landClearance: d.landClearance,
    crop: needsCrop(d.service) ? d.crop : "",
    landType: d.landType,
    cropVariety: asksHarvestDetails(d.service) ? d.cropVariety : "",
    plantedOn: asksHarvestDetails(d.service) ? d.plantedOn : "",
    cropReadiness: asksHarvestDetails(d.service) ? d.cropReadiness : "",
    preferredDate: d.preferredDate,
    alternateDate: d.alternateDate || null,
    district: d.district,
    chiefdom: raw.chiefdom,
    village: d.village,
    notes: d.notes,
  };

  const phone = farmer ? normaliseSierraLeonePhone(farmer.phone ?? "") ?? (farmer.phone ?? "") : normaliseSierraLeonePhone(contact.contactPhone ?? "")!;
  const requestId = str(fd, "requestId");
  if (requestId) {
    // A guest can only ever edit the one request their tracking code let them into.
    if (!farmer && (await guestRequestId()) !== requestId) return { step: 2, values, error: "Find your request with its tracking code first." };
    const saved = await updateRequest(farmer ? farmer.id : guestActor(requestId), requestId, details);
    if (!saved) return { step: 2, values, error: "This request can no longer be edited: a provider has quoted it." };
    if (!farmer) {
      await db.run("UPDATE service_request SET contact_name=?, contact_phone=?, contact_email=? WHERE id=? AND farmer_id IS NULL",
        contact.contactName, phone, contact.contactEmail, requestId);
    }
    redirect(farmer ? `/farmer/requests/${requestId}` : "/request/track?saved=1");
  }

  const created = await createRequest(farmer?.id ?? null, {
    ...details,
    directTo: chosen?.id ?? null,
    contactName: farmer ? farmer.name : contact.contactName!,
    contactPhone: phone,
    contactEmail: farmer ? farmer.email : contact.contactEmail!,
    submissionKey: str(fd, "submissionKey"),
  });

  // Without an account, the tracking code and the phone number are the way back.
  const code = farmer ? null : await issueTrackingCode(created.id, guestActor(created.id));
  if (code) {
    await rememberGuest(created.id);
    await showCodeOnce(created.id, code);
  }

  // The reference is the farmer's way back to this request, so it goes out by email too.
  const email = farmer ? farmer.email : contact.contactEmail;
  if (email) {
    await notify({
      kind: "request.created",
      dedupeKey: `request.created:${created.id}`,
      to: email,
      subject: `Your Sagora request ${created.reference}`,
      text:
        `We have your request for ${d.service} on ${landSize(details.acres)} in ${placeLine(d.village, raw.chiefdom, d.district)}.\n\n` +
        (code
          ? `Your tracking code is ${code}. With your phone number, it opens this request at ${siteUrl()}/request/find\n\n`
          : `Your reference is ${created.reference}. Keep it: it is how you find this request again.\n\n`) +
        `A request is not a booking. Providers will send you quotes, and nothing is confirmed ` +
        `until you accept one and pay.`,
    });
  }

  // Only the work itself: a provider gets no farmer's name or number from this.
  const covering = await providersCovering(d);
  for (const p of chosen ? covering.filter((c) => c.businessId === chosen.id) : covering) {
    await notify({
      kind: "request.new",
      dedupeKey: `request.new:${created.id}:${p.businessId}`,
      to: p.email,
      subject: `New request ${created.reference} in ${d.district}`,
      text: `A farmer in ${d.district} is asking for ${d.service} on ${landSize(details.acres)}. Sign in to Sagora to send a quote.`,
    });
  }

  (await cookies()).delete("sagora_direct");
  redirect(farmer ? `/farmer/requests?new=${created.reference}` : "/request/track");
}

export async function cancelRequest(fd: FormData) {
  const id = String(fd.get("id") ?? "");
  const { requesterFor } = await import("@/lib/requester");
  const who = await requesterFor(id);
  const { cancel } = await import("@/lib/requests");
  await cancel(who.actor, id);
  await flash("Request withdrawn.");
  redirect(who.guest ? who.page : "/farmer/requests");
}
