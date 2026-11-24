"use server";

import { flash } from "@/lib/flash";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/guard";
import {
  AVAILABILITY, KINDS, MAX_GALLERY_PHOTOS, addAsset, addGalleryPhoto, parsePhoto, reportFault, removeGalleryPhoto, setPhoto,
  resolveFault, restoreAsset, retireAsset, setAvailability, updateAsset, type Availability,
} from "@/lib/equipment";
import { SERVICES } from "@/lib/business";
import { SERIAL_STATES, type SerialStatus } from "@/lib/equipment";
import { VERDICTS, savePairing, type Verdict } from "@/lib/pairing";
import { specsFor } from "@/lib/specs";
import type { FormState } from "@/lib/auth-flows";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).trim() : "");
const kindIds = KINDS.map((k) => k.id) as string[];

const serviceIds = SERVICES.map((s) => s.id) as string[];
const serialStates = SERIAL_STATES.map((x) => x.id) as string[];
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
  const ownership = str(fd, "ownership");
  const notes = str(fd, "notes");
  const name = `${brand} ${model}`.trim();

  /* Everything below arrived with Karim's handover of 23 November 2026. */
  const serialStatus = str(fd, "serialStatus") || "recorded";
  const assetRef = str(fd, "assetRef");
  const lessor = str(fd, "lessor");
  const leaseFrom = str(fd, "leaseFrom");
  const leaseTo = str(fd, "leaseTo");
  const leaseNotes = str(fd, "leaseNotes");
  const location = str(fd, "location");
  const custodian = str(fd, "custodian");
  // The specifications that apply to this kind, read off the form by their prefixed names.
  const specs: Record<string, string> = {};
  for (const spec of specsFor(kind)) {
    const value = str(fd, `spec_${spec.id}`);
    if (value) specs[spec.id] = value;
  }

  const fieldErrors: Record<string, string> = {};
  if (!kindIds.includes(kind)) fieldErrors.kind = "Choose the equipment type";
  if (!brand) fieldErrors.brand = "Enter the brand";
  else if (brand.length > 40) fieldErrors.brand = "Use 40 characters or fewer";
  if (!model) fieldErrors.model = "Enter the model";
  else if (model.length > 40) fieldErrors.model = "Use 40 characters or fewer";
  const y = Number(year);
  if (year && (!/^\d{4}$/.test(year) || y < 1940 || y > new Date().getFullYear() + 1)) fieldErrors.year = "Enter a year like 2022";
  const hp = Number(horsepower);
  if (horsepower && (!/^\d{1,4}$/.test(horsepower) || hp < 1 || hp > 1000)) fieldErrors.horsepower = "Enter the horsepower as a number, like 75";
  if (implements_.length > 120) fieldErrors.implements = "Use 120 characters or fewer";
  // Required since the review with Karim (22 Nov 2026). A quote now names specific machines and
  // accepting one commits them, so "the tractor" has to mean one identifiable tractor: without
  // this, two identical machines on a register cannot be told apart on a job sheet or a dispute.
  // Required when there is one to record. The handover allows registering a machine whose plate
  // is unreadable or which never had a number — it just cannot be quoted until Sagora reviews it.
  if (!identifier && serialStatus === "recorded") fieldErrors.identifier = "Enter the registration or serial number";
  else if (identifier.length > 60) fieldErrors.identifier = "Use 60 characters or fewer";
  if (services.length === 0) fieldErrors.services = "Choose what this equipment is used for";
  if (!availabilityIds.includes(availability)) fieldErrors.availability = "Choose whether it can be booked";
  // "Owned or Leased with no default" — so an empty value is an unanswered question, not an
  // assumption that the provider owns it.
  if (ownership !== "owned" && ownership !== "leased") fieldErrors.ownership = "Say whether you own or lease it";
  if (notes.length > 400) fieldErrors.notes = "Use 400 characters or fewer";

  if (!serialStates.includes(serialStatus)) fieldErrors.serialStatus = "Say whether the number is readable";
  if (assetRef.length > 40) fieldErrors.assetRef = "Use 40 characters or fewer";

  if (ownership === "leased") {
    if (lessor.length > 80) fieldErrors.lessor = "Use 80 characters or fewer";
    const dated = (v: string) => !v || /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!dated(leaseFrom)) fieldErrors.leaseFrom = "Enter a date, or leave it empty";
    if (!dated(leaseTo)) fieldErrors.leaseTo = "Enter a date, or leave it empty";
    else if (leaseFrom && leaseTo && leaseTo < leaseFrom) fieldErrors.leaseTo = "The lease cannot end before it starts";
    if (leaseNotes.length > 200) fieldErrors.leaseNotes = "Use 200 characters or fewer";
  }
  if (location.length > 80) fieldErrors.location = "Use 80 characters or fewer";
  if (custodian.length > 80) fieldErrors.custodian = "Use 80 characters or fewer";

  // A number field that is not a number helps nobody later, when a pairing is being checked
  // against it. Said here rather than silently stored.
  for (const spec of specsFor(kind)) {
    const value = specs[spec.id];
    if (!value) continue;
    if (value.length > 80) fieldErrors[`spec_${spec.id}`] = "Use 80 characters or fewer";
    else if (spec.kind === "number" && !/^\d+(\.\d+)?$/.test(value)) fieldErrors[`spec_${spec.id}`] = "Enter a number";
    else if (spec.kind === "choice" && !(spec.options ?? []).includes(value)) fieldErrors[`spec_${spec.id}`] = "Choose one of the options";
  }

  const specValues: Record<string, string> = {};
  for (const [k, v] of Object.entries(specs)) specValues[`spec_${k}`] = v;

  return {
    fieldErrors,
    values: {
      kind, brand, model, year, horsepower, implements: implements_, identifier, services: services.join(","), availability,
      serialStatus, assetRef, lessor, leaseFrom, leaseTo, leaseNotes, location, custodian, ...specValues,
    },
    input: {
      kind, name, identifier, ownership: ownership as "owned" | "leased", notes,
      brand, model, year, horsepower, implements: implements_, services, availability: availability as Availability,
      serialStatus: serialStatus as SerialStatus, assetRef,
      lessor, leaseFrom, leaseTo, leaseNotes, location, custodian, specs,
    },
  };
}

export async function saveAsset(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return { error: "You do not have permission to change equipment." };

  const id = str(fd, "id");
  const { fieldErrors, values, input } = parse(fd);
  // Optional: a photo arrives already shrunk by the browser, as a data URL.
  const sent = str(fd, "photo");
  const photo = sent ? parsePhoto(sent) : null;
  if (sent && !photo) fieldErrors.photo = "That photo could not be used. Choose a JPEG or PNG photo.";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  let savedId = id;
  if (id) {
    if (!await updateAsset(business.id, user.id, id, input)) return { error: "That equipment can no longer be changed.", values };
  } else {
    // The form's own key, so a retry on a bad connection finds the machine it already made rather
    // than adding a second one (A16).
    savedId = (await addAsset(business.id, user.id, { ...input, submissionKey: str(fd, "submissionKey") || null })).id;
  }
  if (photo) await setPhoto(business.id, user.id, savedId, photo);
  revalidatePath("/provider/equipment");
  return { notice: id ? "Equipment updated." : `${input.name} added to your equipment.` };
}

/** A new photo from the details window, sent as soon as it is picked. */
export async function setPhotoAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return;
  const photo = parsePhoto(str(fd, "photo"));
  if (!photo) {
    await flash("That photo could not be used. Choose a JPEG or PNG photo.");
    return;
  }
  await setPhoto(business.id, user.id, str(fd, "id"), photo);
  revalidatePath("/provider/equipment");
}

/** WAITING-ON (7 Nov): "several equipment photos". Extra photos for the detail window's gallery. */
export async function addGalleryPhotoAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return;
  const photo = parsePhoto(str(fd, "photo"));
  if (!photo) {
    await flash("That photo could not be used. Choose a JPEG or PNG photo.");
    return;
  }
  const added = await addGalleryPhoto(business.id, user.id, str(fd, "id"), photo);
  if (!added) await flash(`You can add up to ${MAX_GALLERY_PHOTOS} photos.`);
  revalidatePath("/provider/equipment");
}

export async function removeGalleryPhotoAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return;
  await removeGalleryPhoto(business.id, user.id, str(fd, "id"), str(fd, "photoId"));
  revalidatePath("/provider/equipment");
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
  const retired = await retireAsset(business.id, user.id, str(fd, "id"), str(fd, "reason") || "No reason given");
  // Said rather than swallowed: a provider stopped from retiring a machine needs to know what is
  // still pointing at it, because the answer is a job they have to move.
  if (!retired.ok) {
    await flash(retired.reason);
    revalidatePath("/provider/equipment");
    return;
  }
  await flash("Equipment retired.");
  revalidatePath("/provider/equipment");
}

export async function restoreAssetAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return;
  await restoreAsset(business.id, user.id, str(fd, "id"));
  await flash("Equipment back in service.");
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
    return { error: "That equipment is not on your register." };
  }
  revalidatePath("/provider/equipment");
  return {
    notice: severity === "blocking"
      ? "Fault recorded. This equipment is now out of service and cannot be put on a job."
      : "Fault recorded. The equipment can still be used.",
  };
}

export async function resolveFaultAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return;
  await resolveFault(business.id, user.id, str(fd, "faultId"), str(fd, "resolution") || "Fixed");
  await flash("Fault marked as fixed.");
  revalidatePath("/provider/equipment");
}

/**
 * Records that a machine and an implement do or do not go together for one service.
 *
 * The handover will not let a type match stand in for this — "developers must verify the actual
 * model pairing rather than treating a generic type as an engineering approval" — so it is a
 * person's judgement, with their name and the day on it, and the basis they decided it on.
 */
export async function savePairingAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return { error: "You do not have permission to change equipment." };

  const machineId = str(fd, "machineId");
  const implementId = str(fd, "implementId");
  const service = str(fd, "service");
  const verdict = str(fd, "verdict");
  const basis = str(fd, "basis");

  if (!implementId) return { error: "Choose the implement this is about." };
  if (!serviceIds.includes(service)) return { error: "Choose the service this pairing is for." };
  if (!VERDICTS.some((v) => v.id === verdict)) return { error: "Say whether they are compatible." };
  // A verdict with nothing behind it is the thing the handover is trying to prevent.
  if (verdict === "compatible" && basis.trim().length < 3) {
    return { error: "Say what you checked — the hitch, the manual, the power it needs." };
  }
  if (basis.length > 300) return { error: "Use 300 characters or fewer." };

  const saved = await savePairing(business.id, user.id, {
    machineId, implementId, service, verdict: verdict as Verdict, basis,
  });
  if (!saved) return { error: "That equipment is not on your register." };
  revalidatePath("/provider/equipment");
  revalidatePath("/provider/requests");
  return { notice: "Pairing recorded." };
}

/* ------------------------------------------- one machine, two providers */

/**
 * Lends a machine to another provider, or takes it back.
 *
 * "A shared asset shares its reservation constraint without sharing business data." The constraint
 * comes free — a hold is on a machine id, so a borrowed tractor collides with itself whichever
 * business quoted it — and the data stays apart because the borrower never gets this machine on
 * their own register: see the note at the top of lib/shares.ts.
 */
export async function shareAssetAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return { error: "You do not have permission to share equipment." };
  const { grantShare } = await import("@/lib/shares");
  const result = await grantShare(business.id, user.id, str(fd, "equipmentId"), str(fd, "toBusinessId"), str(fd, "note"));
  if (!result.ok) return { error: result.reason };
  revalidatePath("/provider/equipment");
  return { notice: "Shared. They can now reserve it, and your dates still come first." };
}

export async function revokeShareAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return;
  const { revokeShare } = await import("@/lib/shares");
  const ok = await revokeShare(business.id, user.id, str(fd, "equipmentId"), str(fd, "fromBusinessId"));
  // Work they have already committed is flagged rather than cancelled, which is what the provider
  // at the other end needs to hear about rather than discover.
  await flash(ok
    ? "Taken back. Any work they had booked with it has been flagged for them."
    : "That machine was not shared with them.");
  revalidatePath("/provider/equipment");
}

/* ---------------------------------------------- a machine deliberately out of action */

/**
 * Books a machine out for a span of days.
 *
 * "Move Record downtime and Record private work inside Equipment." Private work was already a job
 * against a request the business owns, so that half moved rather than being rebuilt; this is the
 * half that did not exist. The distinction worth keeping in mind: a condition of "under repair"
 * says the machine is not available and gives no end date, so nothing can answer a question about
 * next week. A span can.
 */
export async function recordDowntimeAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return { error: "You do not have permission to change equipment." };

  const { isDowntimeKind } = await import("@/lib/downtime-kinds");
  const kind = str(fd, "kind");
  if (!isDowntimeKind(kind)) return { error: "Choose why it is out of action." };

  const { recordDowntime } = await import("@/lib/downtime");
  const result = await recordDowntime(business.id, user.id, {
    equipmentId: str(fd, "equipmentId"),
    kind,
    fromDate: str(fd, "fromDate"),
    toDate: str(fd, "toDate"),
    reason: str(fd, "reason"),
  });
  if (!result.ok) return { error: result.reason };

  revalidatePath("/provider/equipment");
  // The capacity check reads downtime, so the jobs screen's blockers can change too.
  revalidatePath("/provider/jobs");
  return { notice: "Booked out. It will not be offered for work on those days." };
}

export async function cancelDowntimeAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return;
  const { cancelDowntime } = await import("@/lib/downtime");
  const ok = await cancelDowntime(business.id, user.id, str(fd, "id"));
  await flash(ok ? "Called off. The machine is available again." : "That was not booked out.");
  revalidatePath("/provider/equipment");
  revalidatePath("/provider/jobs");
}

/* --------------------------------------- somebody who may see one machine and nothing else */

/**
 * Lets a named person see one machine's utilisation.
 *
 * "Support an authorised asset-owner viewer, scoped to named assets only" (A15). For the donor or
 * lessor who put up a tractor and is entitled to know how it is being used — without a provider
 * login, and without any sight of the provider's customers, prices or other equipment. See
 * lib/asset-viewers.ts for what they can and cannot read.
 */
export async function grantViewerAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return { error: "You do not have permission to share equipment." };
  const { grantViewer } = await import("@/lib/asset-viewers");
  const result = await grantViewer(business.id, user.id, str(fd, "equipmentId"), str(fd, "email"), str(fd, "label"));
  if (!result.ok) return { error: result.reason };
  revalidatePath("/provider/equipment");
  return { notice: "They can now see this machine's use, and nothing else." };
}

export async function revokeViewerAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return;
  const { revokeViewer } = await import("@/lib/asset-viewers");
  const ok = await revokeViewer(business.id, user.id, str(fd, "equipmentId"), str(fd, "email"));
  await flash(ok ? "Access withdrawn." : "They did not have access to that machine.");
  revalidatePath("/provider/equipment");
}
