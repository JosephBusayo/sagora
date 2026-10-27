import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/AuthShell";
import { VerifyCodeForm } from "@/components/auth/forms";
import { getPending } from "@/lib/pending";

export const metadata: Metadata = { title: "Email verification" };

export default async function Page() {
  // No pending sign-up or reset in this browser: nothing to verify.
  if (!(await getPending())) redirect("/provider/sign-in");
  return (
    <AuthShell
      image="/auth/verify-email.jpg"
      title="Email verification"
      subtitle="Enter the verification code sent to your email"
      footer={<Link href="/provider/sign-in">Back to sign in</Link>}
    >
      <VerifyCodeForm />
    </AuthShell>
  );
}
