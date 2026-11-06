import { timingSafeEqual } from "node:crypto";
import { logError } from "@/lib/log";
import { settleSession } from "@/lib/online-payments";

export const dynamic = "force-dynamic";

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/**
 * Monime's notices about checkouts. A notice is only a nudge: it carries the secret Sagora gave
 * Monime when the notices were set up, and even then Sagora reads the checkout back from
 * Monime's API before recording anything. A forged notice can make Sagora look, never pay.
 */
export async function POST(req: Request) {
  const secret = process.env.MONIME_WEBHOOK_SECRET?.trim();
  if (!secret || !same(req.headers.get("x-sagora-webhook-secret") ?? "", secret)) {
    return new Response("Unauthorized", { status: 401 });
  }
  let body: { event?: { name?: string }; object?: { id?: string; type?: string }; data?: { id?: string } };
  try {
    body = await req.json();
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const name = body.event?.name ?? "";
  const sessionId = body.object?.id ?? body.data?.id ?? "";
  if (!name.startsWith("checkout_session.") || !sessionId) return Response.json({ ignored: true });
  try {
    return Response.json({ result: await settleSession(sessionId) });
  } catch (err) {
    // Monime retries a failed notice, which is what is wanted while its API is unreachable.
    logError("monime.webhook", err);
    return new Response("Try again", { status: 503 });
  }
}
