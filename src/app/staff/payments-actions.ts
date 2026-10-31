"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/session";
import { parseAmount } from "@/lib/money";
import { notify } from "@/lib/outbox";
import { db } from "@/lib/db";
import { recordPayment, resolveCase } from "@/lib/payments";
import {
  approveRelease, closePayoutRequest, getRelease, markSent, prepareRefund, resolveDispute, preparePayout, reviseAmount, voidRelease,
} from "@/lib/settlement";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();
const back = (tab: string, message: string, kind: "ok" | "err" = "ok") =>
  redirect(`/staff/payments?tab=${tab}&${kind}=${encodeURIComponent(message)}`);

/** Who to tell about money, looked up rather than passed in a form. */
async function contactsFor(requestId: string) {
  // The quotes around the aliases are not decoration. Postgres folds an unquoted identifier to
  // lower case, so an unquoted alias arrives flattened — "farmeremail" rather than the name the
  // code reads — and the value comes back undefined. Here that would mean the booking
  // confirmation quietly never sends while the screen still says the job is booked.
  // `npm run check:sql` fails the build if one of these loses its quotes again.
  return (await db.get(`SELECT r.reference AS reference, r.contact_email AS "farmerEmail", b.email AS "providerEmail", b.name AS "providerName"
       FROM service_request r
       LEFT JOIN agreement a ON a.request_id = r.id
       LEFT JOIN provider_business b ON b.id = a.business_id
       WHERE r.id = ?`, requestId)) as
    | { reference: string; farmerEmail: string | null; providerEmail: string | null; providerName: string | null }
    | undefined;
}

export async function recordPaymentAction(fd: FormData) {
  const staff = await requireStaff();
  const requestId = str(fd, "requestId");
  const minor = parseAmount(str(fd, "amount"));
  if (minor === null) back("collect", "Enter an amount like 1,500.00", "err");

  const result = await recordPayment(staff.id, {
    requestId,
    amountMinor: minor as number,
    method: str(fd, "method"),
    externalRef: str(fd, "reference"),
    note: str(fd, "note"),
  });
  if (!result.ok) back("collect", result.reason, "err");

  const who = await contactsFor(requestId);
  if (result.ok && result.outcome === "booked" && who) {
    // Booking confirmation is one of the emails the brief requires.
    if (who.farmerEmail) {
      await notify({
        kind: "booking.confirmed",
        dedupeKey: `booking.confirmed:farmer:${requestId}`,
        to: who.farmerEmail,
        subject: `${who.reference} is booked`,
        text:
          `Your payment for ${who.reference} has been received in full and the work is booked.\n\n` +
          `${who.providerName ?? "The provider"} has the machines committed for your dates. ` +
          `You will be asked to confirm the work once it is done.\n\n` +
          `This payment was recorded by hand by our team, not by a payment provider.`,
      });
    }
    if (who.providerEmail) {
      await notify({
        kind: "booking.confirmed",
        dedupeKey: `booking.confirmed:provider:${requestId}`,
        to: who.providerEmail,
        subject: `${who.reference} is paid and booked`,
        text:
          `${who.reference} has been paid in full and is now booked. The machines you scheduled are ` +
          `committed for those dates.\n\nYou are paid once the farmer confirms the work.`,
      });
    }
  }

  revalidatePath("/staff/payments");
  back("collect", (result as { message: string }).message);
}

export async function preparePayoutAction(fd: FormData) {
  const staff = await requireStaff();
  const r = await preparePayout(staff.id, str(fd, "requestId"));
  revalidatePath("/staff/payments");
  back("releases", r.ok ? "Payout prepared. A second person must approve it." : r.reason, r.ok ? "ok" : "err");
}

export async function prepareRefundAction(fd: FormData) {
  const staff = await requireStaff();
  const minor = parseAmount(str(fd, "amount"));
  if (minor === null) back("cases", "Enter an amount like 1,500.00", "err");
  const r = await prepareRefund(staff.id, str(fd, "requestId"), minor as number, str(fd, "reason"));
  revalidatePath("/staff/payments");
  back("releases", r.ok ? "Refund prepared. A second person must approve it." : r.reason, r.ok ? "ok" : "err");
}

export async function approveReleaseAction(fd: FormData) {
  const staff = await requireStaff();
  const r = await approveRelease(staff.id, str(fd, "id"));
  revalidatePath("/staff/payments");
  back("releases", r.ok ? "Approved. It can now be sent." : r.reason, r.ok ? "ok" : "err");
}

export async function reviseReleaseAction(fd: FormData) {
  const staff = await requireStaff();
  const minor = parseAmount(str(fd, "amount"));
  if (minor === null) back("releases", "Enter an amount like 1,500.00", "err");
  const r = await reviseAmount(staff.id, str(fd, "id"), minor as number);
  revalidatePath("/staff/payments");
  back("releases", r.ok ? "Amount changed, so the approval was withdrawn. It needs approving again." : r.reason, r.ok ? "ok" : "err");
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
  back("releases", r.ok ? "Recorded as sent." : (r as { reason: string }).reason, r.ok ? "ok" : "err");
}

export async function voidReleaseAction(fd: FormData) {
  const staff = await requireStaff();
  const r = await voidRelease(staff.id, str(fd, "id"), str(fd, "reason") || "Cancelled by staff");
  revalidatePath("/staff/payments");
  back("releases", r.ok ? "Cancelled." : r.reason, r.ok ? "ok" : "err");
}

export async function resolveCaseAction(fd: FormData) {
  await requireStaff();
  const done = await resolveCase(str(fd, "id"), str(fd, "resolution") || "Resolved by staff");
  revalidatePath("/staff/payments");
  back("cases", done ? "Case closed." : "That case was already closed.", done ? "ok" : "err");
}

export async function closePayoutRequestAction(fd: FormData) {
  const staff = await requireStaff();
  await closePayoutRequest(staff.id, String(fd.get("id") ?? ""));
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
  back("disputes", r.ok ? "Dispute resolved." : r.reason, r.ok ? "ok" : "err");
}
