import type { Metadata } from "next";
import { AuthShell } from "@/components/auth/AuthShell";
import { SignInForm } from "@/components/auth/forms";
import { signInStaffAction } from "./actions";

// Linked from nowhere and kept out of search engines. Passwords and the emailed code are what
// protect it: being unlisted only keeps it out of public view.
export const metadata: Metadata = { title: "Staff sign in", robots: { index: false, follow: false } };

export default function Page() {
  return (
    <AuthShell image="/auth/sign-in.jpg" title="Staff sign in" subtitle="For Sagora staff only">
      <SignInForm action={signInStaffAction} forgotHref="/provider/forgot-password" />
    </AuthShell>
  );
}
