import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { findInvite } from "@/lib/team";
import { JoinForm } from "@/components/team/JoinForm";

export const metadata: Metadata = { title: "Join a team" };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = token === "expired" ? null : findInvite(token);

  if (!invite) {
    return (
      <AuthShell
        image="/auth/sign-up.jpg"
        title="This invitation can't be used"
        subtitle="It may have expired, already been used, or been cancelled. Ask whoever invited you to send a new one."
      >
        <p className="auth__footer"><a href="/provider/sign-in">Go to sign in</a></p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      image="/auth/sign-up.jpg"
      title={`Join ${invite.businessName}`}
      subtitle={`You were invited as ${invite.member.role}. Choose a password to finish setting up ${invite.member.email}.`}
    >
      <JoinForm token={token} name={invite.member.name} />
    </AuthShell>
  );
}
