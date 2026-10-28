"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace } from "@/lib/guard";
import { normaliseSierraLeonePhone } from "@/lib/phone";
import { setDestination } from "@/lib/settlement";
import type { FormState } from "@/app/provider/actions";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

export async function saveDestination(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission !== "full_access") return { error: "You do not have permission to change where money goes." };

  const method = str(fd, "method");
  const accountName = str(fd, "accountName");
  const bank = str(fd, "bank");
  const raw = str(fd, "accountRef");
  const values = { method, accountName, accountRef: raw, bank };

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

  const result = setDestination(business.id, user.id, { method, accountName, accountRef, bank });
  if (!result.ok) return { error: result.reason, values };

  revalidatePath("/provider/payments");
  return { notice: "Saved. Any payout waiting to be sent has gone back for approval." };
}
