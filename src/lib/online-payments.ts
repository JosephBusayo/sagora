import "server-only";
import { randomUUID } from "node:crypto";
import { db } from "./db";
import { logError } from "./log";
import { createCheckoutSession, getCheckoutSession, monimeTestMode } from "./monime";
import { bookingFor, fundsFor, recordPayment } from "./payments";
import { jobForRequest } from "./jobs";
import { tellBooked } from "./payment-notices";
import { agreementFor } from "./quotes";
import { getById, ownedBy, serviceLabel } from "./requests";
import { siteUrl } from "./site";

/**
 * Farmers paying online through Monime's hosted checkout.
 *
 * Sagora opens a checkout for what is still owed and sends the farmer to Monime. The money is
 * recorded only after Sagora has read the checkout back from Monime and seen it completed —
 * whichever of these gets there first: Monime's notice, the farmer coming back, or the daily
 * sweep. Recording goes through recordPayment, the same path staff use, keyed on the checkout's
 * id, so the three arriving together still record the payment once.
 */

type Row = {
  id: string; request_id: string; session_id: string; amount_minor: number; test_mode: number;
  status: string; redirect_url: string; created_at: string;
};

/** A checkout opened in the last 20 minutes for the same amount is reused, not opened again. */
const REUSE_MS = 20 * 60_000;

export type Started = { ok: true; redirectUrl: string } | { ok: false; reason: string };

export async function startCheckout(farmerId: string, requestId: string, back = `/farmer/requests/${requestId}/paid`): Promise<Started> {
  const request = await getById(requestId);
  if (!request || !ownedBy(request, farmerId)) return { ok: false, reason: "That request was not found." };
  const agreement = await agreementFor(requestId);
  if (!agreement) return { ok: false, reason: "Accept a quote before paying." };
  if (await bookingFor(requestId)) return { ok: false, reason: "This job is already paid and booked." };
  // Paying books the work, which needs dates and equipment: before then there is nothing to book.
  const job = await jobForRequest(requestId);
  if (!job?.startDate || !job.assetIds.length) return { ok: false, reason: "You can pay once the provider has scheduled the work." };
  const due = agreement.amountMinor - (await fundsFor(requestId));
  if (due <= 0) return { ok: false, reason: "The full amount has already been received." };

  const recent = await db.get(`SELECT * FROM monime_checkout WHERE request_id=? AND status='pending' AND amount_minor=? AND created_at >= ?
       ORDER BY created_at DESC LIMIT 1`, requestId, due, new Date(Date.now() - REUSE_MS).toISOString()) as Row | undefined;
  // Only while Monime still has it open: one the farmer cancelled must not be handed back.
  if (recent) {
    try {
      if ((await settle(recent)) === "pending") return { ok: true, redirectUrl: recent.redirect_url };
    } catch (err) {
      logError("monime.reuse", err);
    }
    if (await bookingFor(requestId)) return { ok: false, reason: "This job is already paid and booked." };
  }

  const id = randomUUID();
  const site = siteUrl();
  let session;
  try {
    session = await createCheckoutSession({
      key: id,
      name: `Sagora ${request.reference}`,
      reference: request.reference,
      itemName: `${serviceLabel(request.service)} for ${request.reference}`,
      amountMinor: due,
      successUrl: `${site}${back}?checkout=${id}`,
      cancelUrl: `${site}${back}?checkout=${id}`,
      metadata: { requestId, checkoutId: id },
    });
  } catch (err) {
    logError("monime.checkout", err);
    return { ok: false, reason: "We couldn't open the payment page. Please try again in a moment." };
  }
  if (!session?.id || !session.redirectUrl) {
    logError("monime.checkout", new Error("checkout session without id or redirectUrl"));
    return { ok: false, reason: "We couldn't open the payment page. Please try again in a moment." };
  }
  const now = new Date().toISOString();
  await db.run(`INSERT INTO monime_checkout (id, request_id, session_id, amount_minor, test_mode, status, redirect_url, created_by, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?)`, id, requestId, session.id, due, monimeTestMode() ? 1 : 0, "pending", session.redirectUrl, farmerId, now, now);
  return { ok: true, redirectUrl: session.redirectUrl };
}

export type Settled = "paid" | "pending" | "cancelled" | "expired" | "unknown";

/** Reads one checkout back from Monime and records the money if it was paid. Safe to repeat. */
async function settle(row: Row): Promise<Settled> {
  if (row.status === "completed") return "paid";
  const session = await getCheckoutSession(row.session_id);
  const now = new Date().toISOString();
  if (session.status === "cancelled" || session.status === "expired") {
    await db.run("UPDATE monime_checkout SET status=?, updated_at=? WHERE id=? AND status='pending'", session.status, now, row.id);
    return session.status;
  }
  if (session.status !== "completed") return "pending";

  const result = await recordPayment("monime", {
    requestId: row.request_id,
    amountMinor: Number(row.amount_minor),
    method: row.test_mode ? "monime_test" : "monime",
    externalRef: row.session_id,
    note: session.orderNumber ? `Monime order ${session.orderNumber}` : "Paid online",
    source: "monime",
  });
  // Already recorded is the same as recorded: another of the three paths got there first.
  const already = !result.ok && /already been recorded/.test(result.reason);
  if (!result.ok && !already) throw new Error(`Monime payment for ${row.request_id} not recorded: ${result.reason}`);
  await db.run("UPDATE monime_checkout SET status='completed', order_number=?, updated_at=? WHERE id=?", session.orderNumber ?? "", now, row.id);
  if (result.ok && result.outcome === "booked") await tellBooked(row.request_id, "monime");
  return "paid";
}

export async function settleCheckout(checkoutId: string, farmerId?: string): Promise<Settled> {
  const row = await db.get("SELECT c.* FROM monime_checkout c WHERE c.id=?", checkoutId) as Row | undefined;
  if (!row) return "unknown";
  const request = farmerId ? await getById(row.request_id) : null;
  if (farmerId && (!request || !ownedBy(request, farmerId))) return "unknown";
  return settle(row);
}

export async function settleSession(sessionId: string): Promise<Settled> {
  const row = await db.get("SELECT * FROM monime_checkout WHERE session_id=?", sessionId) as Row | undefined;
  return row ? settle(row) : "unknown";
}

/** For the daily job: any checkout still open from the last week, in case a notice went missing. */
export async function sweepCheckouts(): Promise<{ checked: number; paid: number }> {
  const rows = await db.all("SELECT * FROM monime_checkout WHERE status='pending' AND created_at >= ? ORDER BY created_at ASC LIMIT 200",
    new Date(Date.now() - 7 * 86400_000).toISOString()) as Row[];
  let paid = 0;
  for (const row of rows) {
    try {
      if ((await settle(row)) === "paid") paid += 1;
    } catch (err) {
      logError("monime.sweep", err);
    }
  }
  return { checked: rows.length, paid };
}
