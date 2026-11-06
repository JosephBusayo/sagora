"use server";

import { flash } from "@/lib/flash";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/session";
import { parseAmount } from "@/lib/money";
import { notify } from "@/lib/outbox";
import { recordPayment, resolveCase } from "@/lib/payments";
import { contactsFor, tellBooked } from "@/lib/payment-notices";
import {
  approveRelease, closePayoutRequest, getRelease, markSent, prepareRefund, resolveDispute, preparePayout, reviseAmount, voidRelease,
} from "@/lib/settlement";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
async function back(tab: string, message: string, kind: "ok" | "err" = "ok") {
  if (kind === "ok") {
    await flash(message);
    redirect(`/staff/payments?tab=${tab}`);
  }
  redirect(`/staff/payments?tab=${tab}&err=${encodeURIComponent(message)}`);
}

export async function recordPaymentAction(fd: FormData) {
  const staff = await requireStaff();
  const requestId = str(fd, "requestId");
  const minor = parseAmount(str(fd, "amount"));
  if (minor === null) await back("collect", "Enter an amount like 1,500.00", "err");

  const result = await recordPayment(staff.id, {
    requestId,
    amountMinor: minor as number,
    method: str(fd, "method"),
    externalRef: str(fd, "reference"),
    note: str(fd, "note"),
  });
  if (!result.ok) await back("collect", result.reason, "err");

  if (result.ok && result.outcome === "booked") await tellBooked(requestId, "manual");

  revalidatePath("/staff/payments");
  await back("collect", (result as { message: string }).message);
}

export async function preparePayoutAction(fd: FormData) {
  const staff = await requireStaff();
  const r = await preparePayout(staff.id, str(fd, "requestId"));
  revalidatePath("/staff/payments");
  await back("releases", r.ok ? "Payout prepared. A second person must approve it." : r.reason, r.ok ? "ok" : "err");
}

export async function prepareRefundAction(fd: FormData) {
  const staff = await requireStaff();
  const minor = parseAmount(str(fd, "amount"));
  if (minor === null) await back("cases", "Enter an amount like 1,500.00", "err");
  const r = await prepareRefund(staff.id, str(fd, "requestId"), minor as number, str(fd, "reason"));
  revalidatePath("/staff/payments");
  await back("releases", r.ok ? "Refund prepared. A second person must approve it." : r.reason, r.ok ? "ok" : "err");
}

export async function approveReleaseAction(fd: FormData) {
  const staff = await requireStaff();
  const r = await approveRelease(staff.id, str(fd, "id"));
  revalidatePath("/staff/payments");
  await back("releases", r.ok ? "Approved. It can now be sent." : r.reason, r.ok ? "ok" : "err");
}

export async function reviseReleaseAction(fd: FormData) {
  const staff = await requireStaff();
  const minor = parseAmount(str(fd, "amount"));
  if (minor === null) await back("releases", "Enter an amount like 1,500.00", "err");
  const r = await reviseAmount(staff.id, str(fd, "id"), minor as number);
  revalidatePath("/staff/payments");
  await back("releases", r.ok ? "Amount changed, so the approval was withdrawn. It needs approving again." : r.reason, r.ok ? "ok" : "err");
}

export async function markSentAction(fd: FormData) {
  const staff = await requireStaff();
  const id = str(fd, "id");
  const release = await getRelease(id);
  const r = await markSent(staff.id, id, str(fd, "method"), str(fd, "reference"));
  revalidatePath("/staff/payments");

  if (r.ok && release) {
    const who = await contactsFor(release.requestId);
    const to = release.kind === "refund" ? who?.farmerEmail : who?.providerEmail;
    if (to) {
      await notify({
        kind: `${release.kind}.sent`,
        dedupeKey: `${release.kind}.sent:${id}`,
        to,
        subject: release.kind === "refund" ? `Refund sent for ${who?.reference}` : `Payment sent for ${who?.reference}`,
        text:
          release.kind === "refund"
            ? `We have sent a refund for ${who?.reference}.\n\nReason: ${release.reason}\nReference: ${str(fd, "reference")}`
            : `We have sent your payment for ${who?.reference}.\n\nReference: ${str(fd, "reference")}`,
      });
    }
  }
  await back("releases", r.ok ? "Recorded as sent." : (r as { reason: string }).reason, r.ok ? "ok" : "err");
}

export async function voidReleaseAction(fd: FormData) {
  const staff = await requireStaff();
  const r = await voidRelease(staff.id, str(fd, "id"), str(fd, "reason") || "Cancelled by staff");
  revalidatePath("/staff/payments");
  await back("releases", r.ok ? "Cancelled." : r.reason, r.ok ? "ok" : "err");
}

export async function resolveCaseAction(fd: FormData) {
  await requireStaff();
  const done = await resolveCase(str(fd, "id"), str(fd, "resolution") || "Resolved by staff");
  revalidatePath("/staff/payments");
  await back("cases", done ? "Case closed." : "That case was already closed.", done ? "ok" : "err");
}

export async function closePayoutRequestAction(fd: FormData) {
  const staff = await requireStaff();
  await closePayoutRequest(staff.id, String(fd.get("id") ?? ""));
  await flash("Request closed.");
  revalidatePath("/staff/payments");
}

export async function resolveDisputeAction(fd: FormData) {
  const staff = await requireStaff();
  const requestId = str(fd, "requestId");
  const outcome = str(fd, "outcome") === "refund" ? "refund" : "release";
  const note = str(fd, "note");
  const r = await resolveDispute(staff.id, requestId, outcome, note);
  if (r.ok) {
    const who = await contactsFor(requestId);
    const text = outcome === "refund" ? `Sagora has decided to refund the farmer. Note: ${note}` : `Sagora has decided the work stands, and the provider will be paid. Note: ${note}`;
    for (const to of [who?.farmerEmail, who?.providerEmail]) {
      if (to) await notify({ kind: "job.dispute_resolved", to, subject: `The concern on ${who?.reference} is resolved`, text });
    }
  }
  revalidatePath("/staff/payments");
  await back("disputes", r.ok ? "Dispute resolved." : r.reason, r.ok ? "ok" : "err");
}
