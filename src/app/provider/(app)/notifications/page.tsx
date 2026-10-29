import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { NotificationList } from "@/components/app/NotificationList";
import { listFor, unreadCount, type Filter } from "@/lib/notifications";
import { markAllNotificationsRead, markNotificationRead } from "@/app/notification-actions";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const { user } = await requireWorkspace();
  const filter: Filter = (await searchParams).filter === "unread" ? "unread" : "all";
  const notifications = await listFor(user, filter);

  return (
    <Shell crumb={{ label: "Notifications", icon: "bell" }} user={{ name: user.name }} unread={await unreadCount(user)}>
      <PageHead
        title="Notifications"
        subtitle="Everything Sagora has sent you. The same messages go to your email."
      />
      <NotificationList
        notifications={notifications}
        filter={filter}
        basePath="/provider/notifications"
        markReadAction={markNotificationRead}
        markAllAction={markAllNotificationsRead}
      />
    </Shell>
  );
}
