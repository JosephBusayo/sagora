"use server";

import { flash } from "@/lib/flash";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { notify } from "@/lib/outbox";
import { proposeInspectionTime } from "@/lib/inspections";
import { requesterFor } from "@/lib/requester";

/**
 * The farmer puts a time forward for an inspection of their farm (Karim, 22 Nov 2026).
 *
 * A plain form post and a redirect, like accepting a quote, so it works with JavaScript off.
 * It proposes only: the provider has to travel there and confirms the day themselves.
 */
export async function proposeInspectionAction(fd: FormData) {
  const requestId = String(fd.get("requestId") ?? "");
  const businessId = String(fd.get("businessId") ?? "");
  const day = String(fd.get("day") ?? "").trim();
  const who = await requesterFor(requestId);

  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) redirect(`${who.page}?error=${encodeURIComponent("Choose a day for the visit.")}`);
  if (day < new Date().toISOString().slice(0, 10)) {
    redirect(`${who.page}?error=${encodeURIComponent("Choose a day that has not already passed.")}`);
  }

  if (!(await proposeInspectionTime(requestId, businessId, who.actor, day))) {
    redirect(`${who.page}?error=${encodeURIComponent("That inspection is no longer waiting for a time.")}`);
  }

  const row = await db.get(`SELECT b.email AS email, b.name AS name, r.reference AS reference, r.contact_name AS farmer, r.village AS village
       FROM provider_business b JOIN service_request r ON r.id = ? WHERE b.id = ?`, requestId, businessId) as
    { email: string; name: string; reference: string; farmer: string; village: string } | undefined;
  if (row?.email) {
    await notify({
      kind: "inspection.proposed",
      // The day is in the key: a farmer who changes their mind proposes again, and that is a new
      // message, not a duplicate of the first.
      dedupeKey: `inspection.proposed:${requestId}:${businessId}:${day}`,
      to: row.email,
      subject: `${row.farmer} suggested ${day} for the farm visit`,
      text:
        `${row.name}: ${row.farmer} has put ${day} forward for the inspection of their farm in ${row.village} (request ${row.reference}).\n\n` +
        "Open the request and mark the inspection booked for that day if it suits you, or ring them to agree another. " +
        "Nothing is booked until you confirm it.",
    });
  }

  await flash("Thank you. The provider has been asked to confirm that day.");
  redirect(who.page);
}
