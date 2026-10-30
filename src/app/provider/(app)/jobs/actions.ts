"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireWorkspace } from "@/lib/guard";
import { createPrivateJob, getJob, reportNoReplacement, reportWork, scheduleJob, startWork } from "@/lib/jobs";
import { getAsset } from "@/lib/equipment";
import { audit, DISTRICTS, SERVICES } from "@/lib/business";
import { notify } from "@/lib/outbox";
import { db } from "@/lib/db";
import type { FormState } from "@/lib/auth-flows";

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
  if (assetIds.length === 0) fieldErrors.assetIds = "Choose at least one machine";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  const before = await getJob(business.id, jobId);
  const result = await scheduleJob(business.id, user.id, jobId, { startDate, endDate, operatorId, assetIds });
  if (!result.ok) return { error: result.reason, values };

  // Swapping a machine on planned work is recorded, and the farmer is told. The brief: one job
  // reference survives changes, with its history intact.
  const removed = (before?.assetIds ?? []).filter((id) => !assetIds.includes(id));
  const added = assetIds.filter((id) => !(before?.assetIds ?? []).includes(id));
  if (removed.length > 0 && added.length > 0) {
    const name = async (id: string) => (await getAsset(business.id, id))?.name ?? "A machine";
    const detail = `${(await Promise.all(removed.map(name))).join(", ")} replaced by ${(await Promise.all(added.map(name))).join(", ")}`;
    await audit(user.id, "job.machine_replaced", jobId, detail);
    const row = await db.get(`SELECT r.contact_email AS email, r.reference AS reference FROM job j
         JOIN service_request r ON r.id = j.request_id WHERE j.id = ?`, jobId) as { email: string; reference: string } | undefined;
    if (row?.email) {
      await notify({
        kind: "job.machine_replaced",
        to: row.email,
        subject: `A machine has changed on ${row.reference}`,
        text: `${business.name} has changed the plan for ${row.reference}: ${detail}. Your price and terms have not changed.`,
      });
    }
  }

  revalidatePath("/provider/jobs");
  return { notice: "Work scheduled. The machines are committed for those dates." };
}

export async function startWorkAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return;
  await startWork(business.id, user.id, str(fd, "jobId"));
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
        `${business.name} says they have finished ${acres} acres on ${row.reference}.\n\n` +
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
  revalidatePath("/provider/jobs");
}

const privateJob = z.object({
  customerName: z.string().min(2, "Enter the customer's name").max(100, "Use 100 characters or fewer"),
  customerPhone: z.string().max(30, "Use 30 characters or fewer"),
  service: z.string().refine((v) => SERVICES.some((s) => s.id === v), "Choose the work"),
  acres: z.coerce.number().positive("Enter the size in acres").max(10000, "That looks too large"),
  district: z.enum(DISTRICTS, { error: "Choose the district" }),
  village: z.string().min(2, "Enter the village or town").max(100, "Use 100 characters or fewer"),
  notes: z.string().max(500, "Use 500 characters or fewer"),
});

export async function createPrivateJobAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return { error: "You do not have permission to add work." };

  const values = Object.fromEntries(["customerName", "customerPhone", "service", "acres", "district", "village", "notes"].map((k) => [k, str(fd, k)]));
  const parsed = privateJob.safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[String(i.path[0])] ??= i.message;
    return { fieldErrors, values };
  }
  await createPrivateJob(business.id, user.id, parsed.data);
  redirect("/provider/jobs");
}
