import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { VerifyCodeForm } from "@/components/auth/forms";
import { signOut } from "@/app/provider/actions";
import { staffAwaitingCode } from "@/lib/session";
import { isVerified, sendCode } from "@/lib/mfa";
import { sendStaffCode, verifyStaffCode } from "../verify-actions";

export const metadata: Metadata = { title: "Staff verification" };
export const dynamic = "force-dynamic";

/** Hides all but the first letter and the domain: s•••@sagora.sl */
function masked(email: string) {
  const [name, domain] = email.split("@");
  if (!domain) return email;
  // A fixed run of dots, so the length of the real address is not on show either.
  return `${name.slice(0, 1)}${"•".repeat(5)}@${domain}`;
}

/**
 * The second factor for staff. A password gets you this far and no further: the screens behind
 * this one approve providers and move money, so the brief asks for MFA on them.
 */
export default async function Page() {
  const { user, sessionId } = await staffAwaitingCode();
  if (isVerified(sessionId)) redirect("/staff/payments");

  // The code is sent by opening the screen, so there is nothing to click first.
  sendCode(sessionId, user);

  return (
    <AuthShell
      image="/auth/verify-email.jpg"
      title="Staff verification"
      subtitle={`These screens move money, so a password is not enough. Enter the code we sent to ${masked(user.email)}`}
      footer={
        <form action={signOut}>
          <button type="submit" className="resend__button">Sign out instead</button>
        </form>
      }
    >
      <VerifyCodeForm action={verifyStaffCode} resendAction={sendStaffCode} />
    </AuthShell>
  );
}
