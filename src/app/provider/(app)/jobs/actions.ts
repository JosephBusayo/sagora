"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/guard";
import { reportWork, scheduleJob, startWork } from "@/lib/jobs";
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

  const result = await scheduleJob(business.id, user.id, jobId, { startDate, endDate, operatorId, assetIds });
  if (!result.ok) return { error: result.reason, values };

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
  return { notice: "Work reported. The farmer has been asked to confirm it." };
}
