import { sessionExpired } from "@/lib/session";
import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignInForm } from "@/components/auth/forms";
import { readNotice } from "@/lib/pending";
import { signInFarmer } from "../actions";

export const metadata: Metadata = { title: "Sign in" };

export default async function Page({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const { reset } = await searchParams;
  const expired = await sessionExpired();
  const changed = (await readNotice()) === "password-changed";
  return (
    <AuthShell
      image="/auth/verify-email.jpg"
      title="Welcome back"
      subtitle="Enter your details to sign in to your account"
      footer={
        <>
          New to Sagora? <Link href="/farmer/sign-up">Create an account</Link>
        </>
      }
    >
      {changed ? (
        <p className="notice notice--success" role="status" style={{ marginTop: 24 }}>
          Your password has been changed and every device has been signed out. Sign in again.
        </p>
      ) : null}
      {expired ? <p className="notice notice--error" role="status" style={{ marginBottom: 16 }}>Your session has ended. Please sign in again.</p> : null}
      {reset ? (
        <p className="notice notice--success" role="status" style={{ marginTop: 24 }}>
          Your password has been updated. Sign in with your new password.
        </p>
      ) : null}
      <SignInForm action={signInFarmer} forgotHref="/farmer/forgot-password" />
    </AuthShell>
  );
}
