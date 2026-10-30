"use server";

import { redirect } from "next/navigation";
import { acceptQuote, declineQuote } from "@/lib/quotes";
import { requireFarmer } from "@/lib/session";
import { notify } from "@/lib/outbox";
import { db } from "@/lib/db";

/**
 * Plain redirects rather than client state, so accepting a quote works with JavaScript off
 * — a brief requirement for farmer screens.
 */
export async function acceptQuoteAction(fd: FormData) {
  const farmer = await requireFarmer();
  const quoteId = String(fd.get("quoteId") ?? "");
  const requestId = String(fd.get("requestId") ?? "");
  const result = await acceptQuote(quoteId, farmer.id);

  if (!result.ok) redirect(`/farmer/requests/${requestId}?error=${encodeURIComponent(result.reason)}`);

  // Tell the provider their quote was taken. TODO (stage 2): outbox with retries.
  const row = await db.get(`SELECT b.email AS email, b.name AS name, r.reference AS reference
       FROM quote q JOIN provider_business b ON b.id = q.business_id
       JOIN service_request r ON r.id = q.request_id WHERE q.id = ?`, quoteId) as { email: string; name: string; reference: string } | undefined;
  if (row?.email) {
    await notify({
      kind: "quote.accepted",
      dedupeKey: `quote.accepted:${quoteId}`,
      to: row.email,
      subject: `Your quote for ${row.reference} was accepted`,
      text:
        `${row.name}: the farmer accepted your quote for ${row.reference}.\n\n` +
        `The price and terms are fixed at the version they accepted. Payment and the booking ` +
        `itself are arranged separately.`,
    });
  }
  redirect(`/farmer/requests/${requestId}?accepted=1`);
}

export async function declineQuoteAction(fd: FormData) {
  const farmer = await requireFarmer();
  const quoteId = String(fd.get("quoteId") ?? "");
  const requestId = String(fd.get("requestId") ?? "");
  if (await declineQuote(quoteId, farmer.id)) {
    const row = await db.get(`SELECT b.email AS email, r.reference AS reference
         FROM quote q JOIN provider_business b ON b.id = q.business_id
         JOIN service_request r ON r.id = q.request_id WHERE q.id = ?`, quoteId) as { email: string; reference: string } | undefined;
    if (row?.email) {
      await notify({
        kind: "quote.declined",
        dedupeKey: `quote.declined:${quoteId}`,
        to: row.email,
        subject: `Your quote for ${row.reference} was declined`,
        text: `The farmer declined your quote for ${row.reference}.`,
      });
    }
  }
  redirect(`/farmer/requests/${requestId}`);
}
