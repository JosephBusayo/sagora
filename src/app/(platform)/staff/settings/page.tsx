import type { Metadata } from "next";
import Link from "next/link";
import { Icon, type IconName } from "@/components/app/Icon";
import { PageHead } from "@/components/app/Shell";
import { StaffShell } from "@/components/staff/StaffShell";
import { requireStaff } from "@/lib/session";

export const metadata: Metadata = { title: "Settings" };

const ROWS: { href: string; icon: IconName; title: string; body: string; adminOnly?: boolean }[] = [
  { href: "/staff/team", icon: "team", title: "Staff", body: "Invite and remove staff", adminOnly: true },
  { href: "/staff/settings/payments", icon: "payments", title: "Online payments", body: "Monime, the payment provider farmers pay through", adminOnly: true },
  { href: "/staff/settings/account", icon: "user", title: "Account", body: "Manage your personal account details" },
  { href: "/staff/settings/password", icon: "lock", title: "Password and security", body: "Manage your password" },
];

export default async function Page() {
  const staff = await requireStaff();
  return (
    <StaffShell staff={staff} crumb={{ label: "Settings", icon: "settings" }}>
      <PageHead title="Settings" subtitle="Manage your account settings" />
      <div className="settings-list">
        {ROWS.filter((r) => !r.adminOnly || staff.role === "admin").map((r) => (
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
    </StaffShell>
  );
}
