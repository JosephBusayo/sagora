"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { flash } from "@/lib/flash";
import { requireAdmin } from "@/lib/session";
import { DISTRICTS, SERVICES } from "@/lib/business";
import {
  cancelRequestAsAdmin, deleteFarmer, deleteProvider, deleteRequest,
  suspendProvider, updateFarmer, updateProvider, updateRequest, type ActionResult,
} from "@/lib/admin";

/**
 * The super admin's edits. Every one of these calls requireAdmin() first — ordinary staff
 * coordinate and can read, but only an admin reaches into somebody else's record (Karim,
 * 23 Nov 2026). requireAdmin() redirects rather than returning, so there is no path through
 * any of these for a staff account.
 */

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).trim() : "");

/** Plain form posts and redirects, like the rest of the staff screens, so they work without JS. */
async function finish(result: ActionResult, back: string): Promise<never> {
  // A refusal is shown as a refusal. These messages explain why a delete was blocked, and a
  // green toast saying that would read as though it had worked.
  await flash(result.ok ? result.message : result.reason, result.ok ? "success" : "error");
  revalidatePath(back);
  redirect(back);
}

/* --------------------------------------------------------------------- requests */

export async function updateRequestAction(fd: FormData) {
  const admin = await requireAdmin();
  const id = str(fd, "id");
  const service = str(fd, "service");
  const district = str(fd, "district");
  const acres = Number(str(fd, "acres"));

  if (!SERVICES.some((s) => s.id === service)) return finish({ ok: false, reason: "Choose a service." }, "/staff/admin/requests");
  if (!(DISTRICTS as readonly string[]).includes(district)) return finish({ ok: false, reason: "Choose a district." }, "/staff/admin/requests");
  if (!Number.isFinite(acres) || acres <= 0 || acres > 100000) {
    return finish({ ok: false, reason: "Enter the land size in acres, greater than zero." }, "/staff/admin/requests");
  }
  const preferredDate = str(fd, "preferredDate");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) return finish({ ok: false, reason: "Choose a preferred date." }, "/staff/admin/requests");

  return finish(await updateRequest(admin.id, id, {
    service, acres, district,
    chiefdom: str(fd, "chiefdom"), village: str(fd, "village"), preferredDate,
    notes: str(fd, "notes").slice(0, 1000),
    contactName: str(fd, "contactName").slice(0, 120),
    contactPhone: str(fd, "contactPhone").slice(0, 40),
  }), "/staff/admin/requests");
}

export async function deleteRequestAction(fd: FormData) {
  const admin = await requireAdmin();
  return finish(await deleteRequest(admin.id, str(fd, "id")), "/staff/admin/requests");
}

export async function cancelRequestAction(fd: FormData) {
  const admin = await requireAdmin();
  return finish(await cancelRequestAsAdmin(admin.id, str(fd, "id")), "/staff/admin/requests");
}

/* -------------------------------------------------------------------- providers */

export async function updateProviderAction(fd: FormData) {
  const admin = await requireAdmin();
  const name = str(fd, "name");
  if (name.length < 2) return finish({ ok: false, reason: "Enter the business name." }, "/staff/admin/providers");
  const district = str(fd, "district");
  if (district && !(DISTRICTS as readonly string[]).includes(district)) {
    return finish({ ok: false, reason: "Choose a district." }, "/staff/admin/providers");
  }
  return finish(await updateProvider(admin.id, str(fd, "id"), {
    name: name.slice(0, 120), phone: str(fd, "phone").slice(0, 40), district,
    town: str(fd, "town").slice(0, 120), description: str(fd, "description").slice(0, 1000),
  }), "/staff/admin/providers");
}

export async function deleteProviderAction(fd: FormData) {
  const admin = await requireAdmin();
  return finish(await deleteProvider(admin.id, str(fd, "id")), "/staff/admin/providers");
}

export async function suspendProviderAction(fd: FormData) {
  const admin = await requireAdmin();
  return finish(await suspendProvider(admin.id, str(fd, "id")), "/staff/admin/providers");
}

/* ---------------------------------------------------------------------- farmers */

export async function updateFarmerAction(fd: FormData) {
  const admin = await requireAdmin();
  const name = str(fd, "name");
  if (name.length < 2) return finish({ ok: false, reason: "Enter the farmer's name." }, "/staff/admin/farmers");
  return finish(await updateFarmer(admin.id, str(fd, "id"), {
    name: name.slice(0, 120), phone: str(fd, "phone").slice(0, 40),
  }), "/staff/admin/farmers");
}

export async function deleteFarmerAction(fd: FormData) {
  const admin = await requireAdmin();
  return finish(await deleteFarmer(admin.id, str(fd, "id")), "/staff/admin/farmers");
}
