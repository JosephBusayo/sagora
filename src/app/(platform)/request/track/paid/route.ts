import { NextResponse } from "next/server";
import { logError } from "@/lib/log";
import { settleCheckout } from "@/lib/online-payments";
import { guestRequestId } from "@/lib/guest";
import { guestActor } from "@/lib/requests";

export const dynamic = "force-dynamic";

/** Where Monime sends a farmer without an account back after paying. As /farmer/requests/[id]/paid. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const requestId = await guestRequestId();
  if (!requestId) return NextResponse.redirect(new URL("/request/find", url), 303);
  let state = "pending";
  try {
    state = await settleCheckout(url.searchParams.get("checkout") ?? "", guestActor(requestId));
  } catch (err) {
    logError("monime.return", err);
  }
  const back = new URL("/request/track", url);
  back.searchParams.set("payment", state === "paid" ? "received" : state === "cancelled" || state === "expired" ? "cancelled" : "pending");
  return NextResponse.redirect(back, 303);
}
