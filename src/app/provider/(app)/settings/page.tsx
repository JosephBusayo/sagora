import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { Icon, type IconName } from "@/components/app/Icon";

export const metadata: Metadata = { title: "Settings" };

const ROWS: { href: string; icon: IconName; title: string; body: string }[] = [
  { href: "/provider/settings/business", icon: "store", title: "Business details", body: "View and update your business information, contact details and location" },
  { href: "/provider/team", icon: "team", title: "Team", body: "Manage your team members and their permissions" },
  { href: "/provider/settings/account", icon: "account", title: "Account", body: "Manage your personal account details" },
  { href: "/provider/settings/password", icon: "lock", title: "Password and security", body: "Manage your password" },
];

export default async function Page() {
  const { user } = await requireWorkspace();
  return (
    <Shell crumb={{ label: "Settings", icon: "settings" }} user={{ name: user.name }}>
      <PageHead title="Settings" subtitle="Manage your business, team and account settings" />
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
    </Shell>
  );
}
