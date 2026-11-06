import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignUpForm } from "@/components/auth/forms";
import { signUpProvider } from "../actions";

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
      <SignUpForm
        action={signUpProvider}
        nameField={{ name: "businessName", label: "Business name", placeholder: "Enter your business name", autoComplete: "organization" }}
      />
    </AuthShell>
  );
}
