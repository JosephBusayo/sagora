"use server";

import { revalidatePath } from "next/cache";
import { decide, type Decision } from "@/lib/business";
import { sendEmail } from "@/lib/email";
import { requireStaff } from "@/lib/session";
import { db } from "@/lib/db";

const DECISIONS: Decision[] = ["approved", "changes_requested", "rejected"];

export async function reviewBusiness(fd: FormData) {
  const staff = await requireStaff();
  const id = String(fd.get("id") ?? "");
  const decision = String(fd.get("decision") ?? "") as Decision;
  const note = String(fd.get("note") ?? "").trim().slice(0, 500);
  if (!DECISIONS.includes(decision)) return;
  // Asking for changes or rejecting must say why, so the provider knows what to do.
  if (decision !== "approved" && note.length < 5) return;

  const b = decide(id, staff.id, decision, note);
  if (!b) return;

  const owner = db.prepare("SELECT email FROM user WHERE id = ?").get(b.userId) as { email: string } | undefined;
  if (owner) {
    const lines: Record<Decision, string> = {
      approved: `Good news: ${b.name} is approved on Sagora. You can now receive requests.`,
      changes_requested: `We need a few changes to ${b.name} before we can approve it:\n\n${note}\n\nSign in to update your details and submit again.`,
      rejected: `We could not approve ${b.name}.\n\n${note}`,
    };
    void sendEmail({ to: owner.email, subject: "Your Sagora business review", text: lines[decision] }).catch(() => {});
  }
  revalidatePath("/staff/providers");
}
