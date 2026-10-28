import type { Metadata } from "next";
import Image from "next/image";
import { requireFarmer } from "@/lib/session";
import { signOutFarmer } from "../actions";

export const metadata: Metadata = { title: "Home" };

/**
 * Placeholder for the farmer app. The guard below is the real rule: no verified farmer
 * session, no entry. The farmer home, booking and requests screens come in stage 2.
 */
export default async function Page() {
  const user = await requireFarmer();
  const firstName = user.name.trim().split(/\s+/)[0];
  return (
    <main className="setup">
      <div className="setup__card" style={{ maxWidth: 480, textAlign: "center", alignItems: "center" }}>
        <Image src="/brand/logo-mark.png" alt="Sagora" width={70} height={65} style={{ margin: "0 auto" }} />
        <h1 className="auth__title setup__title">Welcome, {firstName}</h1>
        <p className="auth__subtitle">
          Your email is confirmed. Booking ploughing and harvesting comes next: that part of the
          app is not built yet.
        </p>
        <form action={signOutFarmer} className="setup__signout">
          <button type="submit" className="resend__button">Sign out</button>
        </form>
      </div>
    </main>
  );
}
