import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignInForm } from "@/components/auth/forms";
import { signInProvider } from "../actions";
import { readNotice } from "@/lib/pending";

export const metadata: Metadata = { title: "Sign in" };

export default async function Page({ searchParams }: { searchParams: Promise<{ reset?: string; joined?: string }> }) {
  const { reset, joined } = await searchParams;
  const changed = (await readNotice()) === "password-changed";
  return (
    <AuthShell
      image="/auth/sign-in.jpg"
      title="Welcome back"
      subtitle="Enter your details to sign in to your account"
      footer={
        <>
          New to Sagora? <Link href="/provider/sign-up">Create a provider account</Link>
        </>
      }
    >
      {changed ? (
        <p className="notice notice--success" role="status" style={{ marginTop: 24 }}>
          Your password has been changed and every device has been signed out. Sign in again.
        </p>
      ) : null}
      {joined ? (
        <p className="notice notice--success" role="status" style={{ marginTop: 24 }}>
          You have joined the team. Sign in with your new password.
        </p>
      ) : null}
      {reset ? (
        <p className="notice notice--success" role="status" style={{ marginTop: 24 }}>
          Your password has been updated. Sign in with your new password.
        </p>
      ) : null}
      <SignInForm action={signInProvider} forgotHref="/provider/forgot-password" />
    </AuthShell>
  );
}
