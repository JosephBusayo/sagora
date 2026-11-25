"use server";

import { flash } from "@/lib/flash";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireWorkspace } from "@/lib/guard";
import { createPrivateJob, getJob, markMobilised, reconfirmCapacity, reportNoReplacement, reportWork, saveReadiness, scheduleJob, startWork } from "@/lib/jobs";
import { getAsset } from "@/lib/equipment";
import { audit, DISTRICTS, SERVICES } from "@/lib/business";
import { notify } from "@/lib/outbox";
import { db } from "@/lib/db";
import type { FormState } from "@/lib/auth-flows";
import { landSize, landUnit, toAcres } from "@/lib/land-size";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).trim() : "");

export async function scheduleJobAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return { error: "You do not have permission to schedule work." };

  const jobId = str(fd, "jobId");
  const startDate = str(fd, "startDate");
  const endDate = str(fd, "endDate");
  const operatorId = str(fd, "operatorId") || null;
  const assetIds = fd.getAll("assetIds").filter((v): v is string => typeof v === "string");
  const values = { startDate, endDate, operatorId: operatorId ?? "" };

  const fieldErrors: Record<string, string> = {};
  if (!startDate) fieldErrors.startDate = "Choose the day work starts";
  if (!endDate) fieldErrors.endDate = "Choose the day work ends";
  if (assetIds.length === 0) fieldErrors.assetIds = "Choose at least one piece of equipment";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  const before = await getJob(business.id, jobId);
  const result = await scheduleJob(business.id, user.id, jobId, { startDate, endDate, operatorId, assetIds });
  if (!result.ok) return { error: result.reason, values };

  // Swapping a machine on planned work is recorded, and the farmer is told. The brief: one job
  // reference survives changes, with its history intact.
  const removed = (before?.assetIds ?? []).filter((id) => !assetIds.includes(id));
  const added = assetIds.filter((id) => !(before?.assetIds ?? []).includes(id));
  if (removed.length > 0 && added.length > 0) {
    const name = async (id: string) => (await getAsset(business.id, id))?.name ?? "Equipment";
    const detail = `${(await Promise.all(removed.map(name))).join(", ")} replaced by ${(await Promise.all(added.map(name))).join(", ")}`;
    await audit(user.id, "job.machine_replaced", jobId, detail);
    const row = await db.get(`SELECT r.contact_email AS email, r.reference AS reference FROM job j
         JOIN service_request r ON r.id = j.request_id WHERE j.id = ?`, jobId) as { email: string; reference: string } | undefined;
    if (row?.email) {
      await notify({
        kind: "job.machine_replaced",
        // The change itself is the key, so a resubmitted form cannot send it twice while a
        // genuine second swap later still reaches the farmer.
        dedupeKey: `job.machine_replaced:${jobId}:${detail}`,
        to: row.email,
        subject: `Equipment has changed on ${row.reference}`,
        text: `${business.name} has changed the plan for ${row.reference}: ${detail}. Your price and terms have not changed.`,
      });
    }
  }

  revalidatePath("/provider/jobs");
  return { notice: "Work scheduled. The equipment is committed for those dates." };
}

export async function readinessAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return;
  const checks = fd.getAll("check").map(String);
  await saveReadiness(business.id, user.id, str(fd, "jobId"), checks);
  await flash("Readiness saved.");
  revalidatePath("/provider/jobs");
}

export async function mobiliseAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return;
  const result = await markMobilised(business.id, user.id, str(fd, "jobId"));
  // The reason comes from the server rather than a guess here, because since the handover there are
  // four different ways a dispatch can be stopped and "finish the readiness checks" is only one.
  await flash(result.ok ? "Recorded: the equipment is on the way." : result.reason);
  revalidatePath("/provider/jobs");
}

/**
 * The provider looks at the machines again and says they are fit and free.
 *
 * "Capacity that has gone stale stays blocked until it is confirmed again." This is the confirming.
 */
/**
 * Says what was done about a flagged booking.
 *
 * The text is required, because "resolved" with no account of what happened is indistinguishable
 * from making the problem go away quietly — which is the thing the flag exists to prevent.
 */
export async function resolveFlagAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return { error: "You do not have permission to change bookings." };
  const { resolveFlag } = await import("@/lib/flags");
  const result = await resolveFlag(business.id, user.id, str(fd, "flagId"), str(fd, "resolution"));
  if (!result.ok) return { error: result.reason };
  revalidatePath("/provider/jobs");
  return { notice: "Recorded. The booking is clear." };
}

export async function reconfirmCapacityAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return;
  const ok = await reconfirmCapacity(business.id, user.id, str(fd, "jobId"));
  await flash(ok ? "Confirmed. You can dispatch now." : "That job cannot be confirmed.");
  revalidatePath("/provider/jobs");
}

export async function startWorkAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return;
  const ok = await startWork(business.id, user.id, str(fd, "jobId"));
  await flash(ok ? "Work started." : "Record that the equipment is on the way first.");
  revalidatePath("/provider/jobs");
}

export async function reportWorkAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return { error: "You do not have permission to report work." };

  const jobId = str(fd, "jobId");
  const acres = Number(str(fd, "acres"));
  const note = str(fd, "note");
  const fieldErrors: Record<string, string> = {};
  if (!Number.isFinite(acres) || acres <= 0) fieldErrors.acres = "Enter how much was done, in acres";
  if (note.length > 400) fieldErrors.note = "Use 400 characters or fewer";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values: { acres: str(fd, "acres"), note } };

  if (!await reportWork(business.id, user.id, jobId, acres, note)) {
    return { error: "That job is not ready for a work report." };
  }

  // The farmer decides whether this counts as delivered. Silence is not consent.
  const row = await db.get(`SELECT r.contact_email AS email, r.reference AS reference FROM job j
       JOIN service_request r ON r.id = j.request_id WHERE j.id = ?`, jobId) as { email: string; reference: string } | undefined;
  if (row?.email) {
    await notify({
      kind: "job.work_reported",
      dedupeKey: `job.reported:${jobId}:${acres}`,
      to: row.email,
      subject: `${business.name} has reported the work on ${row.reference}`,
      text:
        `${business.name} says they have finished ${landSize(acres)} on ${row.reference}.\n\n` +
        `${note ? `Their note: ${note}\n\n` : ""}` +
        `Sign in to confirm the work was done, or raise a concern. Nothing is settled until you do.`,
    });
  }
  revalidatePath("/provider/jobs");
  return { notice: row?.email ? "Work reported. The farmer has been asked to confirm it." : "Work recorded. This job is finished." };
}

export async function noReplacementAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return;
  await reportNoReplacement(business.id, user.id, str(fd, "jobId"));
  await flash("Sagora has been told. Staff will follow up.");
  revalidatePath("/provider/jobs");
}

const privateJob = z.object({
  customerName: z.string().min(2, "Enter the customer's name").max(100, "Use 100 characters or fewer"),
  customerPhone: z.string().max(30, "Use 30 characters or fewer"),
  service: z.string().refine((v) => SERVICES.some((s) => s.id === v), "Choose the work"),
  acres: z.coerce.number().positive("Enter the land size").max(10000, "That looks too large"),
  district: z.enum(DISTRICTS, { error: "Choose the district" }),
  village: z.string().min(2, "Enter the village or town").max(100, "Use 100 characters or fewer"),
  notes: z.string().max(500, "Use 500 characters or fewer"),
});

export async function createPrivateJobAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return { error: "You do not have permission to add work." };

  const values = Object.fromEntries(["customerName", "customerPhone", "service", "acres", "unit", "district", "village", "notes"].map((k) => [k, str(fd, k)]));
  const parsed = privateJob.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { fieldErrors, values };
  }
  await createPrivateJob(business.id, user.id, { ...parsed.data, acres: toAcres(parsed.data.acres, landUnit(values.unit)) });
  redirect("/provider/jobs");
}

/**
 * Records how a job's earnings are divided between the machines that did it.
 *
 * A14: "where a job used several machines the allocation must reconcile, and anything not allocated
 * must be shown and excluded rather than quietly spread." Shares may come to less than the whole —
 * a provider who can only account for 80% of a job should be able to say so — and the rest then
 * shows as not allocated on the Reports screen rather than being nudged into the nearest machine.
 */
export async function allocateRevenueAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return { error: "You do not have permission to change this." };

  const jobId = str(fd, "jobId");
  const job = await getJob(business.id, jobId);
  if (!job) return { error: "That job is not yours." };

  // Percentages on the form, basis points underneath: a three-machine job does not divide into
  // whole percents, and rounding it in the form would be the quiet spreading A14 forbids.
  const input: { equipmentId: string; shareBp: number }[] = [];
  for (const equipmentId of job.assetIds) {
    const raw = str(fd, `share-${equipmentId}`);
    if (!raw) continue;
    const percent = Number(raw);
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      return { fieldErrors: { [`share-${equipmentId}`]: "Enter a percentage between 0 and 100" } };
    }
    input.push({ equipmentId, shareBp: Math.round(percent * 100) });
  }
  if (input.length === 0) return { error: "Give at least one machine a share, or leave it to split evenly." };

  const { setAllocation } = await import("@/lib/revenue");
  const result = await setAllocation(business.id, user.id, jobId, input);
  if (!result.ok) return { error: result.reason };

  revalidatePath("/provider/jobs");
  revalidatePath("/provider/reports");
  const total = input.reduce((sum, x) => sum + x.shareBp, 0);
  return {
    notice: total === 10_000
      ? "Saved. The whole job is accounted for."
      : `Saved. ${(100 - total / 100).toFixed(2).replace(/\.00$/, "")}% is not allocated and will show separately in Reports.`,
  };
}
