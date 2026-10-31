import { drain } from "@/lib/outbox";

/**
 * Sends whatever is waiting in the outbox, called by Vercel Cron (see vercel.json). Vercel sends
 * CRON_SECRET as a bearer token; without that variable set, this refuses everyone.
 */
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  return Response.json(await drain(100));
}
