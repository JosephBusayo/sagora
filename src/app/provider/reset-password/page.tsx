import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { ResetPasswordForm } from "@/components/auth/forms";
import { getPending } from "@/lib/pending";

export const metadata: Metadata = { title: "Reset password" };

export default async function Page() {
  // Only reachable after a reset code has been checked in this browser.
  const pending = await getPending();
  if (!pending || pending.purpose !== "reset" || !pending.code) redirect("/provider/forgot-password");
  return (
    <AuthShell
      image="/auth/reset-password.jpg"
      title="Reset password"
      subtitle="Create a new password to secure your account"
    >
      <ResetPasswordForm />
    </AuthShell>
  );
}
