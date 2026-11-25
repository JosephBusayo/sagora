"use server";

import { flash } from "@/lib/flash";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { notify } from "@/lib/outbox";
import { acceptInspectionTime, proposeInspectionTime } from "@/lib/inspections";
import { requesterFor } from "@/lib/requester";
import { visitWhen } from "@/lib/visit-time";

type Parties = { email: string; name: string; reference: string; farmer: string; village: string; farmerEmail: string };

async function partiesFor(requestId: string, businessId: string): Promise<Parties | undefined> {
  return await db.get(`SELECT b.email AS email, b.name AS name, r.reference AS reference, r.contact_name AS farmer,
         r.village AS village, r.contact_email AS "farmerEmail"
       FROM provider_business b JOIN service_request r ON r.id = ? WHERE b.id = ?`, requestId, businessId) as Parties | undefined;
}

/**
 * The farmer puts a day and time forward for the visit to their farm. A plain form post and a
 * redirect, like accepting a quote, so it works with JavaScript off. It proposes only: the visit
 * is booked when the provider accepts it.
 */
export async function proposeInspectionAction(fd: FormData) {
  const requestId = String(fd.get("requestId") ?? "");
  const businessId = String(fd.get("businessId") ?? "");
  const day = String(fd.get("day") ?? "").trim();
  const time = String(fd.get("time") ?? "").trim();
  const who = await requesterFor(requestId);
  const back = `${who.page}#visit-${businessId}`;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) redirect(`${who.page}?error=${encodeURIComponent("Choose a day for the visit.")}`);
  if (time && !/^\d{2}:\d{2}$/.test(time)) redirect(`${who.page}?error=${encodeURIComponent("Choose a time for the visit.")}`);
  if (day < new Date().toISOString().slice(0, 10)) {
    redirect(`${who.page}?error=${encodeURIComponent("Choose a day that has not already passed.")}`);
  }

  if (!(await proposeInspectionTime(requestId, businessId, who.actor, day, time, "farmer"))) {
    redirect(`${who.page}?error=${encodeURIComponent("That visit is no longer waiting for a time.")}`);
  }

  const row = await partiesFor(requestId, businessId);
  if (row?.email) {
    const when = visitWhen(day, time);
    await notify({
      kind: "inspection.proposed",
      // The time is in the key: a farmer who changes their mind proposes again, and that is a new
      // message, not a duplicate of the first.
      dedupeKey: `inspection.proposed:${requestId}:${businessId}:farmer:${day}:${time}`,
      to: row.email,
      subject: `${row.farmer} suggested ${when} for the farm visit`,
      text:
        `${row.name}: ${row.farmer} has suggested ${when} for the visit to their farm in ${row.village} (request ${row.reference}).\n\n` +
        "Open the request to accept it, or suggest another day and time. Nothing is booked until you accept.",
    });
  }

  await flash("Sent. The provider will accept it or suggest another time.");
  redirect(back);
}

/** The farmer accepts the day and time the provider suggested, which books the visit. */
export async function acceptInspectionAction(fd: FormData) {
  const requestId = String(fd.get("requestId") ?? "");
  const businessId = String(fd.get("businessId") ?? "");
  const who = await requesterFor(requestId);
  const booked = await acceptInspectionTime(requestId, businessId, who.actor, "farmer");
  if (!booked) redirect(`${who.page}?error=${encodeURIComponent("That suggestion is no longer waiting for you.")}`);

  const row = await partiesFor(requestId, businessId);
  const when = visitWhen(booked.day, booked.time);
  if (row?.email) {
    await notify({
      kind: "inspection.scheduled",
      dedupeKey: `inspection.booked:${requestId}:${businessId}:${booked.day}:${booked.time}`,
      to: row.email,
      subject: `Farm visit booked for ${when}`,
      text: `${row.name}: ${row.farmer} accepted ${when} for the visit to their farm in ${row.village} (request ${row.reference}). The visit is booked.`,
    });
  }
  await flash(`Booked. ${row?.name ?? "The provider"} will visit on ${when}.`);
  redirect(`${who.page}#visit-${businessId}`);
}
