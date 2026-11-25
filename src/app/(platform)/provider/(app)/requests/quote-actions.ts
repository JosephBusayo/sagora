"use server";

import { db } from "@/lib/db";
import { flash } from "@/lib/flash";
import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/guard";
import { parseAmount, formatAmount } from "@/lib/money";
import { RESPONSE_HOURS, sendQuote, withdrawQuote } from "@/lib/quotes";
import { selectableAssets, unavailableReason } from "@/lib/equipment";
import { getById } from "@/lib/requests";
import { coverageOf, covers } from "@/lib/coverage";
import { notify } from "@/lib/outbox";
import { acceptInspectionTime, inspectionBlocksQuote, inspectionFor, proposeInspectionTime, saveInspection, type InspectionInput } from "@/lib/inspections";
import { visitWhen } from "@/lib/visit-time";
import { redirect } from "next/navigation";
import { kitProblem, pairingEnforced } from "@/lib/pairing";
import { coversEveryStage, operationsFor, planTotal, spanOf, stagesNotCovered, type PlannedOperation } from "@/lib/operations";
import { selectableUsableAssets, usableAssets } from "@/lib/shares";
import type { FormState } from "@/lib/auth-flows";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).trim() : "");
const today = () => new Date().toISOString().slice(0, 10);

export async function sendQuoteAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return { error: "You do not have permission to send quotes." };

  const requestId = str(fd, "requestId");
  // Equipment is chosen with the price now, so the farmer sees the machines and the days along
  // with the figure, and the job arrives ready to run (Karim, 22 Nov 2026).
  const assetIds = fd.getAll("assetIds").filter((v): v is string => typeof v === "string" && v.length > 0);

  // Which shape of form this is, before anything is checked. A package posts a window and a price
  // per stage and no single total at all, so the one-stage questions below cannot be asked of it:
  // asked anyway, they fail on fields the provider was never shown, and the quote cannot be sent.
  const ops = await operationsFor(requestId);
  const isPackage = ops.length > 1;

  const raw = {
    amount: str(fd, "amount"),
    includes: str(fd, "includes"),
    startDate: str(fd, "startDate"),
    days: str(fd, "days"),
    dailyRate: str(fd, "dailyRate"),
    operatorId: str(fd, "operatorId"),
    note: str(fd, "note"),
    // "Require confirmation of machine condition and outside commitments at quotation."
    outsideCommitments: str(fd, "outsideCommitments"),
  };
  const confirmed = str(fd, "confirmCapacity") === "yes";
  // Everything the provider typed, so a refusal hands their work back rather than an empty form.
  // The stage fields are named after the operation they belong to, so they are carried whole.
  const stageValues: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("stage-") && typeof v === "string") stageValues[k] = v.trim();
  const values = { ...raw, ...stageValues, assetIds: assetIds.join(","), confirmCapacity: confirmed ? "yes" : "" };

  const fieldErrors: Record<string, string> = {};
  const amountMinor = parseAmount(raw.amount);
  const days = Number(raw.days);
  const dailyRateMinor = parseAmount(raw.dailyRate);
  if (raw.includes.length < 3) fieldErrors.includes = "Say what the price covers";
  if (raw.includes.length > 300) fieldErrors.includes = "Use 300 characters or fewer";
  // One stage: the price, the start and the days are typed once, and these are the fields on the
  // form. A package has none of them — its figures are the stages added up, further down.
  if (!isPackage) {
    if (amountMinor === null) fieldErrors.amount = "Enter the total price, for example 1,500.00";
    if (!raw.startDate) fieldErrors.startDate = "Choose the day you can start";
    else if (raw.startDate < today()) fieldErrors.startDate = "Choose a date in the future";
    if (!raw.days) fieldErrors.days = "Say how many days the work will take";
    else if (!Number.isInteger(days) || days < 1 || days > 120) fieldErrors.days = "Enter a whole number of days, from 1 to 120";
    // The handover asks for the rate as well as the total: "capture numeric working days, daily rate
    // and service total". It is checked against the total rather than used to compute it, because
    // the total is what the farmer agrees to and a provider may round it.
    if (dailyRateMinor === null) fieldErrors.dailyRate = "Enter your rate for one working day";
    else if (amountMinor !== null && days >= 1 && dailyRateMinor * days !== amountMinor) {
      fieldErrors.amount = `The total should be ${days} × your daily rate. Change the rate, the days or the total.`;
    }
  }
  if (assetIds.length === 0) fieldErrors.assetIds = "Choose the equipment you will put on this work";
  if (!raw.operatorId) fieldErrors.operatorId = "Choose the operator who will do the work";
  if (raw.note.length > 500) fieldErrors.note = "Use 500 characters or fewer";
  if (raw.outsideCommitments.length > 300) fieldErrors.outsideCommitments = "Use 300 characters or fewer";
  // A statement, not a formality: Sagora cannot see a tractor break or a neighbour borrow it, so the
  // only thing standing behind a reservation is somebody having just looked.
  if (!confirmed) fieldErrors.confirmCapacity = "Confirm the machines are working and free of other commitments";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  // The list only shows what a business covers. This stops a form posted by hand.
  const target = await getById(requestId);
  if (!target || !covers(await coverageOf(business), target)) return { error: "This request is outside your district or services.", values };

  // "All stages must be covered before the package is quoted." The browse list already hides
  // packages a provider cannot see through, so reaching this means a hand-posted form or a coverage
  // that changed since the page was drawn.
  const cover = await coverageOf(business);
  const covered = cover.areas.filter((a) => a.district === target.district).map((a) => a.service);
  if (!coversEveryStage(covered, ops)) {
    const short = stagesNotCovered(covered, ops).map((o) => o.serviceLabel.toLowerCase()).join(" or ");
    return {
      error: `This request needs ${short} as well, and your coverage does not include it. ` +
        "Every stage of a package has to come from one provider.",
      values,
    };
  }

  // Only this business's own working equipment, whatever the form posted.
  // Machines this business may commit: its own, plus any another provider has lent it. A borrowed
  // machine is reserved through the same hold as an owned one, which is what makes the sharing safe.
  const usable = await selectableUsableAssets(business.id);
  const chosen = assetIds.filter((id) => usable.some((a) => a.id === id));
  if (chosen.length !== assetIds.length) {
    // Say which machine and why, rather than one sentence covering four different situations
    // (Joseph, 25 Nov 2026). A machine waiting for Sagora to approve it, one under repair and
    // one that belongs to somebody else are three different problems with three different
    // answers, and "not available for work" is none of them.
    const all = await usableAssets(business.id);
    const refused = assetIds
      .filter((id) => !chosen.includes(id))
      .map((id) => {
        const a = all.find((x) => x.id === id);
        return a ? `${a.name} — ${(unavailableReason(a) ?? "not available").toLowerCase()}` : null;
      })
      .filter(Boolean);
    return {
      error: refused.length
        ? `${refused.join("; ")}. Take it off this quote, or put that right on the Equipment screen.`
        : "Some of that equipment is not on your register.",
      values,
    };
  }

  // The operator has to be this business's own, whatever the form posted.
  const operator = await db.get(`SELECT id FROM team_member WHERE id=? AND business_id=? AND status='active'`,
    raw.operatorId, business.id) as { id: string } | undefined;
  if (!operator) return { error: "That operator is not on your team.", values };

  const blocked = await inspectionBlocksQuote(requestId, business.id);
  if (blocked) return { error: blocked, values };

  // Two different refusals (see KitProblem in lib/pairing.ts). The catalogue requirement — ploughing
  // needs a tractor and a plough — always blocks, because scheduleJob has always enforced it and a
  // quote that cannot become a job is worse than no quote. The pairing judgement blocks only while
  // pairing_enforced is on, since no provider has recorded one yet.
  const kitIssue = await kitProblem(business.id, target.service, chosen);
  if (kitIssue && (!kitIssue.pairing || (await pairingEnforced()))) return { error: kitIssue.why, values };

  // One stage, and nothing changes: the price, the start and the days the provider typed are the
  // whole plan. Several stages, and each one carries its own window and its own price, read from
  // fields named after the operation they belong to.
  let plan: PlannedOperation[] | undefined;
  // The figures the quote itself carries. For one stage they are what the provider typed; for a
  // package they are read back off the plan, so the total is the stages added up and the dates are
  // the whole run of work rather than the first stage of it.
  let headline = { amountMinor: amountMinor ?? 0, startDate: raw.startDate, days, dailyRateMinor: dailyRateMinor ?? 0 };
  if (isPackage) {
    const built: PlannedOperation[] = [];
    for (const o of ops) {
      const start = str(fd, `stage-${o.id}-start`);
      const stageDays = Number(str(fd, `stage-${o.id}-days`) || "0");
      const stageAmount = parseAmount(str(fd, `stage-${o.id}-amount`));
      const stageRate = parseAmount(str(fd, `stage-${o.id}-rate`));
      if (!/^\d{4}-\d{2}-\d{2}$/.test(start)) {
        fieldErrors[`stage-${o.id}-start`] = `Choose the day ${o.serviceLabel.toLowerCase()} starts`;
      } else if (start < today()) {
        fieldErrors[`stage-${o.id}-start`] = "Choose a date in the future";
      }
      if (!Number.isInteger(stageDays) || stageDays < 1 || stageDays > 120) {
        fieldErrors[`stage-${o.id}-days`] = "Enter a whole number of days, from 1 to 120";
      }
      if (stageAmount === null || stageAmount <= 0) {
        fieldErrors[`stage-${o.id}-amount`] = "Enter the price for this stage";
      }
      if (stageRate === null) fieldErrors[`stage-${o.id}-rate`] = "Enter your rate for one working day";
      else if (stageAmount !== null && stageDays >= 1 && stageRate * stageDays !== stageAmount) {
        fieldErrors[`stage-${o.id}-amount`] = `This stage should be ${stageDays} × your daily rate for it.`;
      }
      built.push({
        operationId: o.id, service: o.service, sequence: o.sequence, startDate: start,
        daysToComplete: stageDays, dailyRateMinor: stageRate ?? 0, amountMinor: stageAmount ?? 0,
      });
    }
    if (Object.keys(fieldErrors).length) return { fieldErrors, values };
    plan = built;

    const span = spanOf(built);
    headline = {
      amountMinor: planTotal(built),
      startDate: span.startDate,
      // The days a package takes is the run from the first stage to the last, travel and the gaps
      // between stages included — that is what "8 December to 14 December" has to add up to on the
      // farmer's screen. The working days are on the stages themselves.
      days: Math.max(1, Math.round((Date.parse(`${span.endDate}T00:00:00Z`) - Date.parse(`${span.startDate}T00:00:00Z`)) / 86400_000) + 1),
      // No single rate covers two stages priced separately. Zero, which every screen already reads
      // as "no rate to show", rather than one stage's rate passed off as the whole package's.
      dailyRateMinor: 0,
    };

    // The kit question is per service, because a tractor and a plough being right for ploughing
    // says nothing about harrowing. All of them have to pass, or the package cannot be sold.
    for (const stage of built) {
      const issue = await kitProblem(business.id, stage.service, chosen);
      if (issue && (!issue.pairing || (await pairingEnforced()))) return { error: issue.why, values };
    }
  }

  const result = await sendQuote(requestId, business.id, user.id, {
    amountMinor: headline.amountMinor,
    includes: raw.includes,
    startDate: headline.startDate,
    note: raw.note,
    daysToComplete: headline.days,
    dailyRateMinor: headline.dailyRateMinor,
    assetIds: chosen,
    operatorId: operator.id,
    plan,
    outsideCommitments: raw.outsideCommitments,
    capacityConfirmed: confirmed,
  });
  if (!result.ok) return { error: result.reason, values };

  const request = await getById(requestId);
  if (request?.contactEmail) {
    const isRevision = result.quote.version > 1;
    const machines = usable.filter((a) => chosen.includes(a.id)).map((a) => a.name).join(", ");
    await notify({
      kind: isRevision ? "quote.revised" : "quote.sent",
      dedupeKey: `quote:${result.quote.id}`,
      to: request.contactEmail,
      subject: `${isRevision ? "Updated quote" : "New quote"} for ${request.reference}`,
      text:
        `${business.name} ${isRevision ? "has updated their quote" : "has quoted"} for your ${request.service} request ${request.reference}.\n\n` +
        `Price: ${formatAmount(result.quote.amountMinor)}\nCovers: ${result.quote.includes}\n` +
        (result.quote.plan.length > 1
          // A package is several pieces of work on several days, and a farmer comparing quotes needs
          // to see which stage falls when rather than one total and one date.
          ? `${result.quote.plan.map((stage) =>
              `${stage.serviceLabel}: ${stage.startDate} to ${stage.endDate}, ${formatAmount(stage.amountMinor)}`).join("\n")}\n`
          : `Can start: ${result.quote.startDate}\nDays to finish: ${result.quote.daysToComplete}\n`) +
        `Equipment: ${machines}\n\n` +
        `This quote holds for ${RESPONSE_HOURS} hours. After that it cannot be accepted and the equipment is released, ` +
        "so answer it while it stands.\n\n" +
        "Sign in to compare quotes and accept one. Accepting agrees the price; it is not a booking " +
        "until payment is arranged.",
    });
  }

  revalidatePath("/provider/requests");
  revalidatePath("/provider/quotes");
  const sent = result.quote.version > 1 ? `Quote updated (version ${result.quote.version}).` : "Quote sent to the farmer.";
  // Sent, but worth knowing: the pairing behind it has not been confirmed by anybody yet.
  return { notice: kitIssue ? `${sent} ${kitIssue}` : sent };
}

/** UC08: the provider's inspection of one farm, kept on the request. */
export async function saveInspectionAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return { error: "You do not have permission to change this request." };
  const requestId = str(fd, "requestId");
  const target = await getById(requestId);
  if (!target || !covers(await coverageOf(business), target)) return { error: "This request is outside your district or services." };
  const status = str(fd, "status");
  if (!["none", "required", "scheduled", "completed"].includes(status)) return { error: "Choose whether an inspection is needed." };
  const input: InspectionInput = {
    status: status as InspectionInput["status"],
    scheduledFor: status === "scheduled" || status === "completed" ? str(fd, "scheduledFor") : "",
    findings: status === "completed" ? str(fd, "findings") : "",
    openQuestions: status === "completed" ? str(fd, "openQuestions") : "",
  };
  const values = { status, scheduledFor: input.scheduledFor, findings: input.findings, openQuestions: input.openQuestions };
  const fieldErrors: Record<string, string> = {};
  if ((status === "scheduled" || status === "completed") && !/^\d{4}-\d{2}-\d{2}$/.test(input.scheduledFor)) {
    fieldErrors.scheduledFor = status === "completed" ? "Say when you inspected the farm" : "Choose the inspection date";
  } else if (status === "scheduled" && input.scheduledFor < today()) fieldErrors.scheduledFor = "Choose a date in the future";
  else if (status === "completed" && input.scheduledFor > today()) fieldErrors.scheduledFor = "An inspection that is done cannot be in the future";
  if (status === "completed" && input.findings.length < 3) fieldErrors.findings = "Say what you found";
  if (input.findings.length > 500 || input.openQuestions.length > 500) fieldErrors.findings ??= "Use 500 characters or fewer";
  // A visit is booked when one side accepts the other's day, never by the provider alone.
  if (status === "scheduled" && (await inspectionFor(requestId, business.id))?.status !== "scheduled") {
    return { error: "A visit is booked when the farmer agrees a day. Suggest a day and time above.", values };
  }
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };
  await saveInspection(requestId, business.id, user.id, input);

  // The farmer has to know, and has to be able to answer: an inspection the provider records
  // silently is how a request sits untouched for a week (Karim, 22 Nov 2026).
  if (target.contactEmail && (status === "required" || status === "scheduled")) {
    await notify({
      kind: `inspection.${status}`,
      dedupeKey: `inspection:${requestId}:${business.id}:${status}:${input.scheduledFor}`,
      to: target.contactEmail,
      subject: status === "required" ? `${business.name} needs to see your farm first` : `Inspection booked for ${target.reference}`,
      text: status === "required"
        ? `${business.name} wants to visit your farm before they price your ${target.service} request ${target.reference}.\n\n` +
          "Nothing is wrong: for some land a provider has to see the ground before they can quote honestly. " +
          "Sign in to put a time forward that suits you, and they will confirm it. There is no charge for the visit.\n\n" +
          "You will not see a price from them until the visit is done."
        : `${business.name} has booked the inspection of your farm for ${input.scheduledFor} (request ${target.reference}).\n\n` +
          "Please make sure someone can show them the land that day. They will send you a price after the visit.",
    });
  }

  revalidatePath("/provider/requests");
  revalidatePath("/farmer/requests");
  return { notice: status === "none" ? "No inspection needed." : "Inspection saved. The farmer has been told.", values };
}

/** Back to the request the provider was answering, with the window open on it. */
const backTo = (reference: string) => `/provider/requests?open=${encodeURIComponent(reference)}`;

/** The provider accepts the day and time the farmer suggested, which books the visit. */
export async function acceptVisitAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  const requestId = String(fd.get("requestId") ?? "");
  const target = await getById(requestId);
  if (!target || permission === "view_jobs" || !covers(await coverageOf(business), target)) redirect("/provider/requests");
  const booked = await acceptInspectionTime(requestId, business.id, user.id, "provider");
  if (!booked) {
    await flash("That suggestion is no longer waiting for you.", "error");
    redirect(backTo(target.reference));
  }
  const when = visitWhen(booked.day, booked.time);
  if (target.contactEmail) {
    await notify({
      kind: "inspection.scheduled",
      dedupeKey: `inspection.booked:${requestId}:${business.id}:${booked.day}:${booked.time}`,
      to: target.contactEmail,
      subject: `Farm visit booked for ${when}`,
      text: `${business.name} accepted ${when} for the visit to your farm (request ${target.reference}). ` +
        "Please make sure someone can show them the land. Your price comes after the visit.",
    });
  }
  revalidatePath("/provider/requests");
  await flash(`Booked for ${when}. The farmer has been told.`);
  redirect(backTo(target.reference));
}

/** The provider suggests a day and time for the visit, or a different one from the farmer's. */
export async function suggestVisitAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  const requestId = String(fd.get("requestId") ?? "");
  const day = String(fd.get("day") ?? "").trim();
  const time = String(fd.get("time") ?? "").trim();
  const target = await getById(requestId);
  if (!target || permission === "view_jobs" || !covers(await coverageOf(business), target)) redirect("/provider/requests");
  const bad = !/^d{4}-d{2}-d{2}$/.test(day) ? "Choose a day for the visit."
    : day < today() ? "Choose a day that has not already passed."
      : time && !/^d{2}:d{2}$/.test(time) ? "Choose a time for the visit." : "";
  if (bad || !(await proposeInspectionTime(requestId, business.id, user.id, day, time, "provider"))) {
    await flash(bad || "This request has no visit waiting for a time.", "error");
    redirect(backTo(target.reference));
  }
  const when = visitWhen(day, time);
  if (target.contactEmail) {
    await notify({
      kind: "inspection.proposed",
      dedupeKey: `inspection.proposed:${requestId}:${business.id}:provider:${day}:${time}`,
      to: target.contactEmail,
      subject: `${business.name} suggested ${when} to visit your farm`,
      text: `${business.name} would like to visit your farm on ${when} (request ${target.reference}).

` +
        "Open your request to accept it, or choose another day and time. Nothing is booked until you accept.",
    });
  }
  revalidatePath("/provider/requests");
  await flash("Sent. The farmer will accept it or suggest another time.");
  redirect(backTo(target.reference));
}

export async function withdrawQuoteAction(fd: FormData) {
  const { user, business, permission } = await requireWorkspace();
  if (permission === "view_jobs") return;
  await withdrawQuote(String(fd.get("requestId") ?? ""), business.id, user.id);
  await flash("Quote withdrawn.");
  revalidatePath("/provider/quotes");
  revalidatePath("/provider/requests");
}

/* myQuoteFor() lived here: nothing called it, and it read a quote row raw, so it would have
   handed back a quote with neither its days nor its equipment on it. The page builds that shape
   from lib/quotes.ts instead — see provider/(app)/requests/page.tsx. */
