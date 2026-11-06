"use server";

import { redirect } from "next/navigation";
import { requireFarmer } from "@/lib/session";
import { monimeOfferedTo } from "@/lib/monime";
import { startCheckout } from "@/lib/online-payments";

/** "Pay now": opens Monime's payment page for what is still owed. A plain redirect, so it works without JavaScript. */
export async function payOnlineAction(fd: FormData) {
  const farmer = await requireFarmer();
  const requestId = String(fd.get("requestId") ?? "");
  if (!monimeOfferedTo(farmer.email)) redirect(`/farmer/requests/${requestId}`);
  const started = await startCheckout(farmer.id, requestId);
  if (!started.ok) redirect(`/farmer/requests/${requestId}?error=${encodeURIComponent(started.reason)}`);
  redirect(started.redirectUrl);
}
