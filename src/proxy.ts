import { NextResponse, type NextRequest } from "next/server";
import { APP_USER_AGENT } from "@/lib/app-shell";

/**
 * The phone app opens the site at its root, the same as a browser, and is sent straight to the
 * app's own entrance instead of the landing page. It is done here rather than in the landing
 * page itself because that page is static: reading a header inside it would make every visitor's
 * marketing page server-rendered to serve the few arriving from the app.
 */
export function proxy(req: NextRequest) {
  if (req.headers.get("user-agent")?.includes(APP_USER_AGENT)) {
    return NextResponse.redirect(new URL("/app", req.url));
  }
  return NextResponse.next();
}

// Only the landing page. Everywhere else the app and the browser behave identically.
export const config = { matcher: "/" };
