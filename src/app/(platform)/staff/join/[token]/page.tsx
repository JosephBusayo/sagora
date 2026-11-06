import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { StaffJoinForm } from "@/components/staff/StaffJoinForm";
import { findStaffInvite } from "@/lib/staff";

export const metadata: Metadata = { title: "Join Sagora staff", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const invite = await findStaffInvite(token);
  if (!invite) {
    return (
      <AuthShell image="/auth/sign-up.jpg" title="This invitation can't be used" subtitle="It may have expired, already been used, or been cancelled. Ask for a new one.">
        <span />
      </AuthShell>
    );
  }
  return (
    <AuthShell image="/auth/sign-up.jpg" title="Join Sagora staff" subtitle={`Choose a password to finish setting up ${invite.email}.`}>
      <StaffJoinForm token={token} name={invite.name} />
    </AuthShell>
  );
}
