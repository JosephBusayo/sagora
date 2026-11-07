"use server";

import { redirect } from "next/navigation";
import { requesterFor } from "@/lib/requester";
import { monimeOfferedTo } from "@/lib/monime";
import { startCheckout } from "@/lib/online-payments";

/** "Pay now": opens Monime's payment page for what is still owed. A plain redirect, so it works without JavaScript. */
export async function payOnlineAction(fd: FormData) {
  const requestId = String(fd.get("requestId") ?? "");
  const who = await requesterFor(requestId);
  if (!monimeOfferedTo(who.email)) redirect(who.page);
  const started = await startCheckout(who.actor, requestId, who.paidPath);
  if (!started.ok) redirect(`${who.page}?error=${encodeURIComponent(started.reason)}`);
  redirect(started.redirectUrl);
}
