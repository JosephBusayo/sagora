import { PendingButton } from "@/components/app/PendingButton";
import type { Metadata } from "next";
import Link from "next/link";
import { requireFarmer } from "@/lib/session";
import { Shell, PageHead } from "@/components/app/Shell";
import { Icon, type IconName } from "@/components/app/Icon";
import { unreadCount } from "@/lib/notifications";
import { signOutFarmer } from "../actions";

export const metadata: Metadata = { title: "Settings" };
export const dynamic = "force-dynamic";

const ROWS: { href: string; icon: IconName; title: string; body: string }[] = [
  { href: "/farmer/settings/account", icon: "user", title: "Account", body: "Your name and phone number" },
  { href: "/farmer/settings/password", icon: "lock", title: "Password", body: "Change the password you sign in with" },
  { href: "/farmer/payments", icon: "payments", title: "Payments", body: "Everything you have paid and been refunded" },
];

export default async function Page() {
  const farmer = await requireFarmer();
  return (
    <Shell
      crumb={{ label: "Settings", icon: "settings" }}
      user={{ name: farmer.name }}
      audience="farmer"
      unread={await unreadCount(farmer)}
    >
      <PageHead title="Settings" subtitle="Your account details and how you sign in" />
      <div className="settings-list">
        {ROWS.map((r) => (
          <Link key={r.href} href={r.href} className="settings-row">
            <span className="settings-row__icon"><Icon name={r.icon} size={24} /></span>
            <span className="settings-row__body">
              <h2>{r.title}</h2>
              <p>{r.body}</p>
            </span>
            <span className="settings-row__chev"><Icon name="chevron" size={18} /></span>
          </Link>
        ))}
      </div>

      {/* The design has a logout confirmation: signing out by accident on a shared phone is
          annoying, and this is the one place someone goes looking for the button. */}
      <section className="panel">
        <h2 className="quotes__heading">Sign out</h2>
        <p className="field__helper">
          You will need your email and password to get back in. Your requests and bookings stay exactly as they are.
        </p>
        <details className="disclosure">
          <summary className="button button--ghost">Sign out of Sagora</summary>
          <form action={signOutFarmer} className="inline-form">
            <p className="field__helper">Sign out on this device?</p>
            <PendingButton className="button">Yes, sign me out</PendingButton>
          </form>
        </details>
      </section>
    </Shell>
  );
}
