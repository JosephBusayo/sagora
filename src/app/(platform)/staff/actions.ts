"use server";

import { revalidatePath } from "next/cache";
import { decide, type Decision } from "@/lib/business";
import { notify } from "@/lib/outbox";
import { requireStaff } from "@/lib/session";
import { db } from "@/lib/db";
import { signOutTo } from "@/lib/auth-flows";
import type { FormState } from "@/app/(platform)/provider/actions";

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

  const b = await decide(id, staff.id, decision, note);
  if (!b) return { error: "This business was already decided. Reload the page." };

  const owner = await db.get(`SELECT email FROM "user" WHERE id = ?`, b.userId) as { email: string } | undefined;
  if (owner) {
    const lines: Record<Decision, string> = {
      approved: `Good news: ${b.name} is approved on Sagora. You can now receive requests.`,
      changes_requested: `We need a few changes to ${b.name} before we can approve it:\n\n${note}\n\nSign in to update your details and submit again.`,
      rejected: `We could not approve ${b.name}.\n\n${note}`,
    };
    await notify({
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

/** Staff sign out back to their own sign-in screen. */
export async function signOutStaff() {
  return signOutTo("provider", "/staff/sign-in");
}

/** UC03: a provider asked to work somewhere new. Approve or decline every waiting district and service of that business. */
export async function decideAreasAction(fd: FormData) {
  const staff = await requireStaff();
  const { decideAreas, pendingChanges, byDistrict } = await import("@/lib/coverage");
  const { flash } = await import("@/lib/flash");
  const id = String(fd.get("businessId") ?? "");
  const approve = String(fd.get("decision") ?? "") === "approve";
  const change = (await pendingChanges()).find((p) => p.businessId === id);
  const n = await decideAreas(id, staff.id, approve);
  if (n && change?.email) {
    const where = byDistrict(change.areas).map((d) => `${d.district}: ${d.services.join(", ")}`).join("\n");
    await notify({
      kind: approve ? "coverage.approved" : "coverage.declined",
      // Keyed on the decision, not the clock. It used to carry Date.now(), which guaranteed a
      // fresh key every time and so guaranteed no duplicate protection at all: two taps on
      // Approve sent the provider two emails (Joseph, 25 Nov 2026).
      dedupeKey: `coverage:${id}:${approve ? "approved" : "declined"}:${change.areas.map((a) => `${a.district}/${a.service}`).sort().join(",")}`,
      to: change.email,
      subject: approve ? "New districts approved on Sagora" : "Your district request on Sagora",
      text: approve
        ? `${change.name}: you can now receive requests for\n\n${where}`
        : `${change.name}: we could not add\n\n${where}\n\nReply to this email or speak to us on WhatsApp if you want to talk it through.`,
    });
  }
  await flash(n ? (approve ? `Approved for ${change?.name ?? "the provider"}.` : `Declined for ${change?.name ?? "the provider"}.`) : "Already decided.");
  revalidatePath("/staff/providers");
}

/**
 * Staff approve or reject one machine a provider registered.
 *
 * Nothing a provider types into a form is true because the form accepted it: a serial can be
 * copied off somebody else's tractor, a photo can be of a machine that was sold last year. So a
 * new machine is saved but not usable until somebody here has looked at it (migration 035). A
 * rejection carries its reason back to the provider, who can correct it and send it again.
 */
export async function reviewEquipmentAction(fd: FormData) {
  const staff = await requireStaff();
  const { reviewEquipment } = await import("@/lib/equipment");
  const { flash } = await import("@/lib/flash");
  const { db } = await import("@/lib/db");

  const equipmentId = String(fd.get("equipmentId") ?? "");
  const decision = String(fd.get("decision") ?? "") === "approve" ? "approved" : "rejected";
  const note = String(fd.get("note") ?? "").trim();

  const row = await db.get(`SELECT e.name, b.email AS email, b.name AS business FROM equipment e
       JOIN provider_business b ON b.id = e.business_id WHERE e.id = ?`, equipmentId) as
    { name: string; email: string; business: string } | undefined;

  const result = await reviewEquipment(staff.id, equipmentId, decision, note);
  if (!result.ok) {
    await flash(result.reason);
    revalidatePath("/staff/providers");
    return;
  }

  if (row?.email) {
    await notify({
      kind: decision === "approved" ? "equipment.approved" : "equipment.rejected",
      // One decision, one message. A second tap on Approve finds the key already used.
      dedupeKey: `equipment.${decision}:${equipmentId}:${note}`,
      to: row.email,
      subject: decision === "approved"
        ? `${row.name} is approved on Sagora`
        : `${row.name} was not approved on Sagora`,
      text: decision === "approved"
        ? `${row.business}: ${row.name} has been approved. You can now put it on quotes and jobs.`
        : `${row.business}: ${row.name} was not approved.\n\n${note}\n\n` +
          "Open it on your Equipment screen, put that right and save it. That sends it back to us automatically.",
    });
  }
  await flash(decision === "approved" ? `${row?.name ?? "Equipment"} approved.` : `${row?.name ?? "Equipment"} rejected.`);
  revalidatePath("/staff/providers");
  revalidatePath("/provider/equipment");
}
