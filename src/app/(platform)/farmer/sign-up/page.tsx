import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignUpForm } from "@/components/auth/forms";
import { signUpFarmer } from "../actions";

export const metadata: Metadata = { title: "Create an account" };

export default function Page() {
  return (
    <AuthShell
      image="/auth/farmer-sign-up.jpg"
      // The Figma frame reads "Create a provider account" on the farmer screen; that is a
      // copy slip carried over from the provider flow, so the farmer wording is used here.
      title="Create an account"
      subtitle="Enter your email address to continue"
      footer={
        <>
          Already have an account? <Link href="/farmer/sign-in">Sign in</Link>
        </>
      }
    >
      <SignUpForm
        action={signUpFarmer}
        nameField={{ name: "name", label: "First and last name", placeholder: "Enter your name", autoComplete: "name" }}
      />
    </AuthShell>
  );
}
