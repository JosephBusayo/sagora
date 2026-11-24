import { drain } from "@/lib/outbox";
import { monimeConfigured } from "@/lib/monime";
import { sweepCheckouts } from "@/lib/online-payments";
import { purgeExpiredDocuments } from "@/lib/business-documents";
import { sweepExpired } from "@/lib/holds";
import { sweepExpiredQuotes, sweepUnpaidBookings } from "@/lib/quotes";

/**
 * Sends whatever is waiting in the outbox, checks open Monime checkouts, purges any provider
 * document past its retention window, tells both sides about quotes that ran out of time, and
 * frees the machines behind accepted work nobody paid for. Called by Vercel Cron (see vercel.json).
 * Vercel sends CRON_SECRET as a bearer token; without that variable set, this refuses everyone.
 *
 * None of the sweeps below decide anything. Expiry, lapsing and overdue payment are all read from
 * the clock wherever they are shown or enforced, so a late run delays an email and the tidying of a
 * row, never a rule.
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
  // Whether a quote has expired is read from the clock wherever one is shown, so this sweep is
  // only here to send the notices. A late or missed run delays an email, never the rule itself.
  const quotesExpired = await sweepExpiredQuotes();
  // This was imported and never called, so a lapsed quote's holds stayed marked 'held' for ever.
  // It cost nothing in correctness — the clash query excludes expired holds itself — and it made
  // every provider's "what am I holding" screen wrong, which is the sort of thing that teaches
  // people not to trust the screen.
  const holdsReleased = await sweepExpired();
  // A07: accepted work nobody paid for stops holding the calendar. The agreement survives; the
  // dates do not.
  const bookingsLapsed = await sweepUnpaidBookings();
  return Response.json({
    outbox: await drain(100), checkouts, documentsPurged, quotesExpired, holdsReleased, bookingsLapsed,
  });
}
