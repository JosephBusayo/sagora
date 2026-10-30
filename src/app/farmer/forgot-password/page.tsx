import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { ForgotPasswordForm } from "@/components/auth/forms";
import { requestFarmerPasswordReset } from "../actions";

export const metadata: Metadata = { title: "Forgot password" };

export default async function Page({ searchParams }: { searchParams: Promise<{ expired?: string }> }) {
  const { expired } = await searchParams;
  return (
    <AuthShell
      image="/auth/farmer-forgot-password.jpg"
      title="Forgot password"
      subtitle="Enter your email to get a one time verification code"
      footer={<Link href="/farmer/sign-in">Back to sign in</Link>}
    >
      {expired ? (
        <p className="notice notice--error" role="alert" style={{ marginTop: 24 }}>
          That reset session expired. Request a new code.
        </p>
      ) : null}
      <ForgotPasswordForm action={requestFarmerPasswordReset} />
    </AuthShell>
  );
}
