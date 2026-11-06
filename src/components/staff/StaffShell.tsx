import { waitUntil } from "@vercel/functions";
import { Shell } from "@/components/app/Shell";
import { TableLabels } from "@/components/app/TableLabels";
import type { IconName } from "@/components/app/Icon";
import { drain } from "@/lib/outbox";
import type { SessionUser } from "@/lib/session";
import { waitingOnStaff } from "@/lib/staff-waiting";

/**
 * The staff screens, in the same frame as the farmer and provider apps: sidebar, search, bell,
 * settings and account. The bell counts what is waiting on staff.
 */
export async function StaffShell({ staff, crumb, search, children }: {
  staff: SessionUser;
  crumb: { label: string; icon: IconName };
  search?: string;
  children: React.ReactNode;
}) {
  // Vercel's free plan runs the scheduled send once a day, so a staff visit also nudges the queue.
  waitUntil(drain().catch(() => {}));
  const waiting = await waitingOnStaff();
  return (
    <Shell crumb={crumb} user={{ name: staff.name || staff.email }} audience="staff" admin={staff.role === "admin"} unread={waiting.total} search={search}>
      <div className="staff-page">{children}</div>
      <TableLabels />
    </Shell>
  );
}
