import type { Metadata } from "next";
import Link from "next/link";
import { EmptyState } from "@/components/app/EmptyState";
import { Icon, type IconName } from "@/components/app/Icon";
import { PageHead } from "@/components/app/Shell";
import { StaffShell } from "@/components/staff/StaffShell";
import { requireStaff } from "@/lib/session";
import { waitingOnStaff } from "@/lib/staff-waiting";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

const ICONS: Record<string, IconName> = { review: "store", disputes: "info", cases: "payments", releases: "payments", outbox: "quotes" };

/** What is waiting on staff, each line pointing to the screen where it is dealt with. */
export default async function Page() {
  const staff = await requireStaff();
  const { items } = await waitingOnStaff();
  const open = items.filter((i) => i.count > 0);
  return (
    <StaffShell staff={staff} crumb={{ label: "Notifications", icon: "bell" }}>
      <PageHead title="Notifications" subtitle="What is waiting on staff right now" />
      {open.length === 0 ? (
        <div className="table-card"><EmptyState icon="bell" title="Nothing is waiting" body="Everything that needs staff has been dealt with." /></div>
      ) : (
        <div className="settings-list">
          {open.map((i) => (
            <Link key={i.id} href={i.href} className="settings-row">
              <span className="settings-row__icon"><Icon name={ICONS[i.id] ?? "bell"} size={24} /></span>
              <span className="settings-row__body">
                <h2>{i.title} <span className="pill pill--awaiting_quotes">{i.count}</span></h2>
                <p>{i.body}</p>
              </span>
              <span className="settings-row__chev"><Icon name="chevron" size={18} /></span>
            </Link>
          ))}
        </div>
      )}
    </StaffShell>
  );
}
