"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { markAllRead, markRead } from "@/lib/notifications";

/**
 * Shared by both apps: the signed-in person is read from the session, never from the form, and
 * the notification is checked against their own email before anything is marked.
 */
async function me() {
  const s = await auth.api.getSession({ headers: await headers() });
  const u = s?.user as { id: string; email: string; role?: string | null } | undefined;
  if (!u) redirect("/provider/sign-in");
  return u;
}

const backTo = (role: string | null | undefined, filter: string) => {
  const base = role === "farmer" ? "/farmer/notifications" : "/provider/notifications";
  return filter === "unread" ? `${base}?filter=unread` : base;
};

/** Opens what a notification is about, and marks it read on the way. */
export async function openNotificationAction(fd: FormData) {
  const user = await me();
  await markRead(user, String(fd.get("id") ?? ""));
  const href = String(fd.get("href") ?? "");
  // Only ever a path on this site, whatever the form says.
  redirect(/^\/[a-z]/.test(href) ? href : "/");
}

export async function markNotificationRead(fd: FormData) {
  const user = await me();
  await markRead(user, String(fd.get("id") ?? ""));
  redirect(backTo(user.role, String(fd.get("filter") ?? "")));
}

export async function markAllNotificationsRead(fd: FormData) {
  const user = await me();
  await markAllRead(user);
  redirect(backTo(user.role, String(fd.get("filter") ?? "")));
}
