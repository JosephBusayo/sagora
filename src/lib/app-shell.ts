import "server-only";
import { headers } from "next/headers";

/**
 * Whether this request came from the phone app rather than a browser.
 *
 * The app's web view appends a marker to its user agent (see capacitor.config.ts). That is the
 * only difference between the two: the app loads the same site, so a farmer sees the same prices
 * and the same quotes either way, and nothing can drift between them.
 *
 * Used sparingly, and only for what genuinely differs - the app has no landing page to show, and
 * no need to offer "download the app" to someone already holding it.
 */
export const APP_USER_AGENT = "SagoraApp";

export async function inPhoneApp(): Promise<boolean> {
  return (await headers()).get("user-agent")?.includes(APP_USER_AGENT) ?? false;
}
