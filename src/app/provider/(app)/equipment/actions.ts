"use server";

import { flash } from "@/lib/flash";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/guard";
import { KINDS, addAsset, reportFault, resolveFault, restoreAsset, retireAsset, updateAsset } from "@/lib/equipment";
import type { FormState } from "@/lib/auth-flows";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).trim() : "");
const kindIds = KINDS.map((k) => k.id) as string[];

function parse(fd: FormData) {
  const kind = str(fd, "kind");
  const name = str(fd, "name");
  const identifier = str(fd, "identifier");
  const ownership = str(fd, "ownership");
  const notes = str(fd, "notes");

  const fieldErrors: Record<string, string> = {};
  if (!kindIds.includes(kind)) fieldErrors.kind = "Choose what kind of machine this is";
  if (name.length < 2) fieldErrors.name = "Give this machine a name you will recognise";
  if (name.length > 80) fieldErrors.name = "Use 80 characters or fewer";
  if (identifier.length > 60) fieldErrors.identifier = "Use 60 characters or fewer";
  if (ownership !== "owned" && ownership !== "leased") fieldErrors.ownership = "Say whether you own or lease it";
  if (notes.length > 400) fieldErrors.notes = "Use 400 characters or fewer";

  return {
    fieldErrors,
    values: { kind, name, identifier, ownership, notes },
    input: { kind, name, identifier, ownership: ownership as "owned" | "leased", notes },
  };
}

export async function saveAsset(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return { error: "You do not have permission to change equipment." };

  const id = str(fd, "id");
  const { fieldErrors, values, input } = parse(fd);
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  if (id) {
    if (!await updateAsset(business.id, user.id, id, input)) return { error: "That machine can no longer be changed.", values };
  } else {
    await addAsset(business.id, user.id, input);
  }
  revalidatePath("/provider/equipment");
  return { notice: id ? "Machine updated." : `${input.name} added to your equipment.` };
}

export async function retireAssetAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return;
  await retireAsset(business.id, user.id, str(fd, "id"), str(fd, "reason") || "No reason given");
  await flash("Machine retired.");
  revalidatePath("/provider/equipment");
}

export async function restoreAssetAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return;
  await restoreAsset(business.id, user.id, str(fd, "id"));
  await flash("Machine back in service.");
  revalidatePath("/provider/equipment");
}

export async function reportFaultAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return { error: "You do not have permission to report faults." };

  const equipmentId = str(fd, "equipmentId");
  const severity = str(fd, "severity");
  const description = str(fd, "description");
  const fieldErrors: Record<string, string> = {};
  if (severity !== "blocking" && severity !== "minor") fieldErrors.severity = "Say how serious it is";
  if (description.length < 4) fieldErrors.description = "Describe the fault";
  if (description.length > 400) fieldErrors.description = "Use 400 characters or fewer";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values: { severity, description } };

  if (!await reportFault(business.id, user.id, equipmentId, severity as "blocking" | "minor", description)) {
    return { error: "That machine is not on your register." };
  }
  revalidatePath("/provider/equipment");
  return {
    notice: severity === "blocking"
      ? "Fault recorded. This machine is now out of service and cannot be put on a job."
      : "Fault recorded. The machine can still be used.",
  };
}

export async function resolveFaultAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return;
  await resolveFault(business.id, user.id, str(fd, "faultId"), str(fd, "resolution") || "Fixed");
  await flash("Fault marked as fixed.");
  revalidatePath("/provider/equipment");
}
