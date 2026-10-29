"use server";

import { redirect } from "next/navigation";
import { confirmDelivery, raiseConcern } from "@/lib/jobs";
import { requireFarmer } from "@/lib/session";
import { notify } from "@/lib/outbox";
import { db } from "@/lib/db";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).trim() : "");

async function providerEmail(requestId: string) {
  return (await db.get(`SELECT b.email AS email, r.reference AS reference FROM job j
       JOIN provider_business b ON b.id = j.business_id
       JOIN service_request r ON r.id = j.request_id WHERE j.request_id = ?`, requestId)) as { email: string; reference: string } | undefined;
}

export async function confirmDeliveryAction(fd: FormData) {
  const farmer = await requireFarmer();
  const requestId = str(fd, "requestId");
  const result = await confirmDelivery(farmer.id, requestId);
  if (!result.ok) redirect(`/farmer/requests/${requestId}?error=${encodeURIComponent(result.reason)}`);

  const row = await providerEmail(requestId);
  if (row?.email) {
    await notify({
      kind: "job.confirmed",
      dedupeKey: `job.confirmed:${requestId}`,
      to: row.email,
      subject: `${row.reference} confirmed by the farmer`,
      text: `The farmer has confirmed the work on ${row.reference}. Settlement is arranged separately.`,
    });
  }
  redirect(`/farmer/requests/${requestId}?confirmed=1`);
}

export async function raiseConcernAction(fd: FormData) {
  const farmer = await requireFarmer();
  const requestId = str(fd, "requestId");
  const result = await raiseConcern(farmer.id, requestId, str(fd, "concern"));
  if (!result.ok) redirect(`/farmer/requests/${requestId}?error=${encodeURIComponent(result.reason)}`);

  const row = await providerEmail(requestId);
  if (row?.email) {
    await notify({
      kind: "job.concern",
      dedupeKey: `job.concern:${requestId}`,
      to: row.email,
      subject: `A concern was raised on ${row.reference}`,
      text: `The farmer has raised a concern about the work on ${row.reference}:\n\n${str(fd, "concern")}\n\nSagora will follow up.`,
    });
  }
  redirect(`/farmer/requests/${requestId}?concern=1`);
}
