import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignInForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Sign in" };

export default async function Page({ searchParams }: { searchParams: Promise<{ reset?: string }> }) {
  const { reset } = await searchParams;
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
      {reset ? (
        <p className="notice notice--success" role="status" style={{ marginTop: 24 }}>
          Your password has been updated. Sign in with your new password.
        </p>
      ) : null}
      <SignInForm />
    </AuthShell>
  );
}
