"use server";

import { revalidatePath } from "next/cache";
import { decide, type Decision } from "@/lib/business";
import { notify } from "@/lib/outbox";
import { requireStaff } from "@/lib/session";
import { db } from "@/lib/db";
import type { FormState } from "@/app/provider/actions";

const DECISIONS: Decision[] = ["approved", "changes_requested", "rejected"];

export async function reviewBusiness(_prev: FormState, fd: FormData): Promise<FormState> {
  const staff = await requireStaff();
  const id = String(fd.get("id") ?? "");
  const decision = String(fd.get("decision") ?? "") as Decision;
  const note = String(fd.get("note") ?? "").trim().slice(0, 500);

  if (!DECISIONS.includes(decision)) return { error: "Choose approve, ask for changes, or reject." };
  // Asking for changes or rejecting must say why, so the provider knows what to do.
  if (decision !== "approved" && note.length < 5) {
    return { fieldErrors: { note: "Say what needs to change before you send this back." } };
  }

  const b = decide(id, staff.id, decision, note);
  if (!b) return { error: "This business was already decided. Reload the page." };

  const owner = db.prepare("SELECT email FROM user WHERE id = ?").get(b.userId) as { email: string } | undefined;
  if (owner) {
    const lines: Record<Decision, string> = {
      approved: `Good news: ${b.name} is approved on Sagora. You can now receive requests.`,
      changes_requested: `We need a few changes to ${b.name} before we can approve it:\n\n${note}\n\nSign in to update your details and submit again.`,
      rejected: `We could not approve ${b.name}.\n\n${note}`,
    };
    notify({
      kind: `business.${decision}`,
      dedupeKey: `business.review:${b.id}:${b.reviewedAt ?? ""}`,
      to: owner.email,
      subject: "Your Sagora business review",
      text: lines[decision],
    });
  }
  revalidatePath("/staff/providers");
  const said: Record<Decision, string> = {
    approved: `${b.name} is approved.`,
    changes_requested: `Sent back to ${b.name} with your note.`,
    rejected: `${b.name} was rejected.`,
  };
  return { notice: said[decision] };
}
