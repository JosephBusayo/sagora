import { NextResponse } from "next/server";
import { requireFarmer } from "@/lib/session";
import { logError } from "@/lib/log";
import { settleCheckout } from "@/lib/online-payments";

export const dynamic = "force-dynamic";

/**
 * Where Monime sends the farmer back after paying. The page they land on must not wait for
 * Monime's notice, so the checkout is read back here too; whichever arrives first records it.
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const farmer = await requireFarmer();
  const { id } = await params;
  const url = new URL(req.url);
  const checkout = url.searchParams.get("checkout") ?? "";
  let state = "pending";
  try {
    state = await settleCheckout(checkout, farmer.id);
  } catch (err) {
    logError("monime.return", err);
  }
  const back = new URL(`/farmer/requests/${encodeURIComponent(id)}`, url);
  back.searchParams.set("payment", state === "paid" ? "received" : state === "cancelled" || state === "expired" ? "cancelled" : "pending");
  return NextResponse.redirect(back, 303);
}
