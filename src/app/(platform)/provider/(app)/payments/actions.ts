"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/guard";
import { normaliseSierraLeonePhone } from "@/lib/phone";
import { requestPayout, setDestination } from "@/lib/settlement";
import { checkVerificationCode, requiresVerification, sendVerificationCode } from "@/lib/monime-verify";
import type { FormState } from "@/app/(platform)/provider/actions";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function saveDestination(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission !== "full_access") return { error: "You do not have permission to change where money goes." };

  const method = str(fd, "method");
  const accountName = str(fd, "accountName");
  const bank = str(fd, "bank");
  const raw = str(fd, "accountRef");
  const code = str(fd, "code") || str(fd, "codeFallback");
  const values = { method, accountName, accountRef: raw, bank };

  // "Use a different number", from the code step: drop back to plain fields with nothing sent yet.
  if (str(fd, "resetCode")) return { values };

  const fieldErrors: Record<string, string> = {};
  if (accountName.length < 2) fieldErrors.accountName = "Enter the name on the account";

  // A mobile money destination is a phone number, so it gets the same check as every other.
  let accountRef = raw;
  if (method === "mobile_money") {
    const phone = normaliseSierraLeonePhone(raw);
    if (!phone) fieldErrors.accountRef = "Enter a valid Sierra Leone number, for example 76 123 456";
    else accountRef = phone;
  } else if (raw.length < 4) {
    fieldErrors.accountRef = "Enter the account number";
  }
  if (method === "bank" && bank.length < 2) fieldErrors.bank = "Enter the bank name";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  // WAITING-ON #2 (7 Nov): the design asks for a code to the Monime number before it is saved.
  // Inert — skipped entirely — until an SMS provider is configured (lib/sms.ts).
  if (requiresVerification(method)) {
    if (!code) {
      await sendVerificationCode(business.id, accountRef);
      return { values: { ...values, awaitingCode: "1" }, notice: `We sent a code to ${accountRef}. Enter it below to confirm this number.` };
    }
    const check = await checkVerificationCode(business.id, accountRef, code);
    if (!check.ok) return { fieldErrors: { code: check.reason }, values: { ...values, awaitingCode: "1" } };
  }

  const result = await setDestination(business.id, user.id, { method, accountName, accountRef, bank });
  if (!result.ok) return { error: result.reason, values };

  revalidatePath("/provider/payments");
  return { notice: "Saved. Any payout waiting to be sent has gone back for approval." };
}

export async function requestPayoutAction() {
  const { user, business, permission } = await requireWorkspace();
  if (permission !== "full_access") redirect("/provider/payments");
  const result = await requestPayout(business.id, user.id);
  redirect(result.ok ? `/provider/payments?submitted=${result.value}` : `/provider/payments?error=${encodeURIComponent(result.reason)}`);
}
