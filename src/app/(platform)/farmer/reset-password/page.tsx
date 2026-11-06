import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { ResetPasswordForm } from "@/components/auth/forms";
import { getPending } from "@/lib/pending";
import { resetFarmerPassword } from "../actions";

export const metadata: Metadata = { title: "Reset password" };

export default async function Page() {
  const pending = await getPending();
  if (!pending || pending.purpose !== "reset" || !pending.code) redirect("/farmer/forgot-password");
  return (
    <AuthShell image="/auth/reset-password.jpg" title="Reset password" subtitle="Create a new password to secure your account">
      <ResetPasswordForm action={resetFarmerPassword} />
    </AuthShell>
  );
}
