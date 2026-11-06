import { drain } from "@/lib/outbox";
import { monimeConfigured } from "@/lib/monime";
import { sweepCheckouts } from "@/lib/online-payments";

/**
 * Sends whatever is waiting in the outbox and checks open Monime checkouts, called by Vercel Cron (see vercel.json). Vercel sends
 * CRON_SECRET as a bearer token; without that variable set, this refuses everyone.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  // Also reads back any Monime checkout still open, in case its notice never arrived.
  const checkouts = monimeConfigured() ? await sweepCheckouts() : null;
  return Response.json({ outbox: await drain(100), checkouts });
}
