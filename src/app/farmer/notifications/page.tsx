import type { Metadata } from "next";
import { requireFarmer } from "@/lib/session";
import { Shell, PageHead } from "@/components/app/Shell";
import { NotificationList } from "@/components/app/NotificationList";
import { listFor, unreadCount, type Filter } from "@/lib/notifications";
import { markAllNotificationsRead, markNotificationRead } from "@/app/notification-actions";

export const metadata: Metadata = { title: "Notifications" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const farmer = await requireFarmer();
  const filter: Filter = (await searchParams).filter === "unread" ? "unread" : "all";

  return (
    <Shell
      crumb={{ label: "Notifications", icon: "bell" }}
      user={{ name: farmer.name }}
      audience="farmer"
      unread={await unreadCount(farmer)}
    >
      <PageHead
        title="Notifications"
        subtitle="Quotes, bookings and payments on your requests. The same messages go to your email."
      />
      <NotificationList
        notifications={await listFor(farmer, filter)}
        filter={filter}
        basePath="/farmer/notifications"
        markReadAction={markNotificationRead}
        markAllAction={markAllNotificationsRead}
      />
    </Shell>
  );
}
