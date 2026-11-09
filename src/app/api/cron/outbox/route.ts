import { drain } from "@/lib/outbox";
import { monimeConfigured } from "@/lib/monime";
import { sweepCheckouts } from "@/lib/online-payments";
import { purgeExpiredDocuments } from "@/lib/business-documents";

/**
 * Sends whatever is waiting in the outbox, checks open Monime checkouts, and purges any provider
 * document past its retention window, called by Vercel Cron (see vercel.json). Vercel sends
 * CRON_SECRET as a bearer token; without that variable set, this refuses everyone.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  // Also reads back any Monime checkout still open, in case its notice never arrived.
  const checkouts = monimeConfigured() ? await sweepCheckouts() : null;
  // Inert until DOCUMENT_RETENTION_DAYS is set — see lib/business-documents.ts.
  const documentsPurged = await purgeExpiredDocuments();
  return Response.json({ outbox: await drain(100), checkouts, documentsPurged });
}
