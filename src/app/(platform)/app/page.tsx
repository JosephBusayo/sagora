import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { homeForRole } from "@/lib/audience";
import { signedInUser } from "@/lib/session";

export const metadata: Metadata = { title: "Sagora" };
export const dynamic = "force-dynamic";

/**
 * Where the phone app opens. The app has no landing page to show - someone who has installed it
 * has already decided - so this is the first thing after the splash screen.
 *
 * Someone already signed in never sees it: they go straight to their own home, which is what
 * makes the app feel like an app rather than a web page asking them to sign in again every time.
 * The session lives in the web view's cookie, so that holds between launches.
 */
export default async function Page() {
  const user = await signedInUser();
  if (user) redirect(homeForRole(user.role));

  return (
    <AuthShell
      image="/auth/verify-email.jpg"
      title="Welcome to Sagora"
      subtitle="Get farm work done with trusted service providers near you"
      footer={<>Sent a request without an account? <Link href="/request/find">Find it here</Link></>}
    >
      <div className="app-entry">
        <Link href="/farmer/sign-in" className="button">I need farm work done</Link>
        <Link href="/provider/sign-in" className="button button--ghost">I offer services</Link>
        <p className="app-entry__note">
          New to Sagora? <Link href="/farmer/sign-up">Create an account</Link>
        </p>
      </div>
    </AuthShell>
  );
}
