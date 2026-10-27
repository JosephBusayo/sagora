import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignUpForm } from "@/components/auth/forms";

export const metadata: Metadata = { title: "Create a provider account" };

export default function Page() {
  return (
    <AuthShell
      image="/auth/sign-up.jpg"
      title="Create a provider account"
      subtitle="Enter your email address to continue"
      footer={
        <>
          Already have an account? <Link href="/provider/sign-in">Sign in</Link>
        </>
      }
    >
      <SignUpForm />
    </AuthShell>
  );
}
