"use server";

import { revalidatePath } from "next/cache";
import { flash } from "@/lib/flash";
import { THRESHOLDS, saveFollowUp, setSetting } from "@/lib/follow-ups";
import { TEST_EMAILS_KEY } from "@/lib/sagora-report";
import { requireStaff } from "@/lib/session";
import { listStaff } from "@/lib/staff";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Owner, next action and due date for one queue item. Nothing about the item itself changes. */
export async function saveFollowUpAction(fd: FormData) {
  const staff = await requireStaff();
  const key = str(fd, "key").slice(0, 200);
  if (!key) return;
  const owner = str(fd, "ownerId");
  const staffIds = new Set((await listStaff()).map((s) => s.id));
  const dueOn = /^\d{4}-\d{2}-\d{2}$/.test(str(fd, "dueOn")) ? str(fd, "dueOn") : "";
  await saveFollowUp(staff.id, key, {
    ownerId: owner && staffIds.has(owner) ? owner : null,
    nextAction: str(fd, "nextAction").slice(0, 200),
    dueOn,
    note: str(fd, "note").slice(0, 400),
  });
  await flash("Follow-up saved.");
  revalidatePath("/staff/follow-ups");
}

/** How long things may wait. Admins only: it changes what everyone sees as overdue. */
export async function saveThresholdsAction(fd: FormData) {
  const staff = await requireStaff();
  if (staff.role !== "admin") return;
  for (const t of THRESHOLDS) {
    const n = Math.floor(Number(str(fd, t.key)));
    if (Number.isFinite(n) && n >= 1 && n <= 365) await setSetting(staff.id, t.key, String(n));
  }
  await flash("Saved.");
  revalidatePath("/staff/follow-ups");
}

/** Accounts whose activity is left out of the Sagora report. Admins only. */
export async function saveTestEmailsAction(fd: FormData) {
  const staff = await requireStaff();
  if (staff.role !== "admin") return;
  const emails = str(fd, "emails").split(/[\s,]+/).map((e) => e.toLowerCase()).filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
  await setSetting(staff.id, TEST_EMAILS_KEY, [...new Set(emails)].join(","));
  await flash("Saved.");
  revalidatePath("/staff/report");
}
