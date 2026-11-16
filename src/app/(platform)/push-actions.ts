"use server";

import { forgetDevice, registerDevice, type Platform } from "@/lib/push";
import { signedInUser } from "@/lib/session";

const PLATFORMS: Platform[] = ["android", "ios", "web"];

/**
 * Remembers the phone the signed-in person is holding, so Sagora can tell them about a quote
 * without relying on email. Called on every launch: the token changes by itself now and then,
 * and re-registering is how a device stays current.
 *
 * Returns nothing and refuses quietly. A phone that cannot register should get an app that
 * works without notifications, not an error it cannot act on.
 */
export async function registerPushDevice(token: string, platform: string): Promise<void> {
  const user = await signedInUser();
  if (!user || !token || token.length > 512) return;
  if (!PLATFORMS.includes(platform as Platform)) return;
  await registerDevice(user.id, token, platform as Platform);
}

/** Signing out on a phone stops that phone buzzing. */
export async function forgetPushDevice(token: string): Promise<void> {
  if (token) await forgetDevice(token);
}
