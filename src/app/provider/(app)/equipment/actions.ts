"use server";

import { flash } from "@/lib/flash";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/guard";
import { AVAILABILITY, KINDS, addAsset, reportFault, resolveFault, restoreAsset, retireAsset, setAvailability, updateAsset, type Availability } from "@/lib/equipment";
import { SERVICES } from "@/lib/business";
import type { FormState } from "@/lib/auth-flows";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).trim() : "");
const kindIds = KINDS.map((k) => k.id) as string[];

const serviceIds = SERVICES.map((s) => s.id) as string[];
const availabilityIds = AVAILABILITY.map((a) => a.id) as string[];

/**
 * The Add equipment and Edit details screens. A machine is listed under its brand and model, so
 * those two make its name. Ownership and notes are no longer asked; an edit keeps what was there.
 */
function parse(fd: FormData) {
  const kind = str(fd, "kind");
  const brand = str(fd, "brand");
  const model = str(fd, "model");
  const year = str(fd, "year");
  const horsepower = str(fd, "horsepower");
  const implements_ = str(fd, "implements");
  const identifier = str(fd, "identifier");
  const services = fd.getAll("services").map(String).filter((s) => serviceIds.includes(s));
  const availability = str(fd, "availability") || "available";
  const ownership = str(fd, "ownership") || "owned";
  const notes = str(fd, "notes");
  const name = `${brand} ${model}`.trim();

  const fieldErrors: Record<string, string> = {};
  if (!kindIds.includes(kind)) fieldErrors.kind = "Choose what kind of machine this is";
  if (!brand) fieldErrors.brand = "Enter the brand";
  else if (brand.length > 40) fieldErrors.brand = "Use 40 characters or fewer";
  if (!model) fieldErrors.model = "Enter the model";
  else if (model.length > 40) fieldErrors.model = "Use 40 characters or fewer";
  const y = Number(year);
  if (year && (!/^\d{4}$/.test(year) || y < 1940 || y > new Date().getFullYear() + 1)) fieldErrors.year = "Enter a year like 2022";
  const hp = Number(horsepower);
  if (horsepower && (!/^\d{1,4}$/.test(horsepower) || hp < 1 || hp > 1000)) fieldErrors.horsepower = "Enter the horsepower as a number, like 75";
  if (implements_.length > 120) fieldErrors.implements = "Use 120 characters or fewer";
  if (identifier.length > 60) fieldErrors.identifier = "Use 60 characters or fewer";
  if (services.length === 0) fieldErrors.services = "Choose what this machine is used for";
  if (!availabilityIds.includes(availability)) fieldErrors.availability = "Choose whether it can be booked";
  if (ownership !== "owned" && ownership !== "leased") fieldErrors.ownership = "Say whether you own or lease it";
  if (notes.length > 400) fieldErrors.notes = "Use 400 characters or fewer";

  return {
    fieldErrors,
    values: { kind, brand, model, year, horsepower, implements: implements_, identifier, services: services.join(","), availability },
    input: {
      kind, name, identifier, ownership: ownership as "owned" | "leased", notes,
      brand, model, year, horsepower, implements: implements_, services, availability: availability as Availability,
    },
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

export async function setAvailabilityAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return;
  const availability = str(fd, "availability");
  if (!availabilityIds.includes(availability)) return;
  await setAvailability(business.id, user.id, str(fd, "id"), availability as Availability);
  revalidatePath("/provider/equipment");
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
