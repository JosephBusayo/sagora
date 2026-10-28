"use server";

import { redirect } from "next/navigation";
import { confirmDelivery, raiseConcern } from "@/lib/jobs";
import { requireFarmer } from "@/lib/session";
import { sendEmail } from "@/lib/email";
import { db } from "@/lib/db";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).trim() : "");

function providerEmail(requestId: string) {
  return db
    .prepare(
      `SELECT b.email AS email, r.reference AS reference FROM job j
       JOIN provider_business b ON b.id = j.business_id
       JOIN service_request r ON r.id = j.request_id WHERE j.request_id = ?`,
    )
    .get(requestId) as { email: string; reference: string } | undefined;
}

export async function confirmDeliveryAction(fd: FormData) {
  const farmer = await requireFarmer();
  const requestId = str(fd, "requestId");
  const result = confirmDelivery(farmer.id, requestId);
  if (!result.ok) redirect(`/farmer/requests/${requestId}?error=${encodeURIComponent(result.reason)}`);

  const row = providerEmail(requestId);
  if (row?.email) {
    void sendEmail({
      to: row.email,
      subject: `${row.reference} confirmed by the farmer`,
      text: `The farmer has confirmed the work on ${row.reference}. Settlement is arranged separately.`,
    }).catch(() => {});
  }
  redirect(`/farmer/requests/${requestId}?confirmed=1`);
}

export async function raiseConcernAction(fd: FormData) {
  const farmer = await requireFarmer();
  const requestId = str(fd, "requestId");
  const result = raiseConcern(farmer.id, requestId, str(fd, "concern"));
  if (!result.ok) redirect(`/farmer/requests/${requestId}?error=${encodeURIComponent(result.reason)}`);

  const row = providerEmail(requestId);
  if (row?.email) {
    void sendEmail({
      to: row.email,
      subject: `A concern was raised on ${row.reference}`,
      text: `The farmer has raised a concern about the work on ${row.reference}:\n\n${str(fd, "concern")}\n\nSagora will follow up.`,
    }).catch(() => {});
  }
  redirect(`/farmer/requests/${requestId}?concern=1`);
}
