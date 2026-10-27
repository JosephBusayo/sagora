import type { Metadata } from "next";
import Image from "next/image";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { signOut } from "../actions";

export const metadata: Metadata = { title: "Setup" };

/**
 * Placeholder for the provider workspace. The check below is the real rule from the
 * brief: no verified session, no entry. The setup overview itself comes in the next stage.
 */
export default async function Page() {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || !session.user.emailVerified) redirect("/provider/sign-in");

  const business = (session.user as { businessName?: string | null }).businessName ?? session.user.name;
  return (
    <main className="shell-placeholder">
      <div className="shell-placeholder__card">
        <Image src="/brand/logo-mark.png" alt="Sagora" width={70} height={65} style={{ margin: "0 auto" }} />
        <h1 className="auth__title" style={{ marginTop: 28 }}>
          Welcome, {business}
        </h1>
        <p className="auth__subtitle">Your email is confirmed. Business setup comes next.</p>
        <form action={signOut} style={{ marginTop: 28 }}>
          <button type="submit" className="button">
            Sign out
          </button>
        </form>
      </div>
    </main>
  );
}
