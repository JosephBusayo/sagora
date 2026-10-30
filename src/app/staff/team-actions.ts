"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/lib/auth-flows";
import { notify } from "@/lib/outbox";
import { requireAdmin } from "@/lib/session";
import { siteUrl } from "@/lib/site";
import { cancelInvite, inviteStaff, removeStaff } from "@/lib/staff";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function inviteStaffAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const admin = await requireAdmin();
  const email = str(fd, "email").toLowerCase();
  const name = str(fd, "name");
  const role = str(fd, "role") === "admin" ? "admin" : "staff";
  const values = { email, name, role };

  if (!z.email().safeParse(email).success) return { fieldErrors: { email: "Enter a valid email address" }, values };
  if (name.length < 2) return { fieldErrors: { name: "Enter their name" }, values };

  const result = await inviteStaff(admin.id, { email, name, role });
  if (!result.ok) return { error: result.reason, values };

  const link = `${siteUrl()}/staff/join/${result.token}`;
  await notify({
    kind: "staff.invited",
    to: email,
    subject: "You have been invited to Sagora staff",
    text: `${admin.name} invited you to Sagora staff. Set up your account here within 7 days:\n\n${link}`,
  });
  revalidatePath("/staff/team");
  // Shown once, because email may not reach them until the sending domain is verified.
  return { notice: `Invitation ready. Send this link to ${name}: ${link}` };
}

export async function cancelInviteAction(fd: FormData) {
  const admin = await requireAdmin();
  await cancelInvite(admin.id, str(fd, "id"));
  revalidatePath("/staff/team");
}

export async function removeStaffAction(fd: FormData) {
  const admin = await requireAdmin();
  await removeStaff(admin.id, str(fd, "id"));
  revalidatePath("/staff/team");
}
