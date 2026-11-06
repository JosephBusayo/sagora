"use server";

import { logError } from "@/lib/log";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { requireFarmer } from "@/lib/session";
import { normaliseSierraLeonePhone } from "@/lib/phone";
import { setNotice } from "@/lib/pending";
import type { FormState } from "@/lib/auth-flows";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).trim() : "");

/**
 * The farmer's own account. Same rules as the provider's: the email is read-only here because
 * changing it has to re-verify, which is a separate flow and has no design yet.
 */
export async function saveFarmerAccount(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireFarmer();
  const name = str(fd, "name");
  const phone = normaliseSierraLeonePhone(str(fd, "phone"));
  const values = { name, phone: str(fd, "phone") };

  const fieldErrors: Record<string, string> = {};
  if (name.length < 2) fieldErrors.name = "Enter your first and last name";
  if (!phone) fieldErrors.phone = "Enter a valid Sierra Leone number, for example 76 123 456";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  try {
    await auth.api.updateUser({ body: { name, phone }, headers: await headers() });
  } catch (err) {
    logError("farmer.settings", err);
    return { error: "We couldn't save your details. Please try again.", values };
  }
  revalidatePath("/farmer/settings/account");
  return { notice: "Your details have been saved." };
}

export async function changeFarmerPassword(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireFarmer();
  const current = String(fd.get("current") ?? "");
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");

  const fieldErrors: Record<string, string> = {};
  if (!current) fieldErrors.current = "Enter your current password";
  if (password.length < 8) fieldErrors.password = "Use at least 8 characters";
  if (password !== confirm) fieldErrors.confirm = "Passwords do not match";
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  try {
    await auth.api.changePassword({
      body: { currentPassword: current, newPassword: password, revokeOtherSessions: true },
      headers: await headers(),
    });
  } catch (err) {
    const code = err instanceof APIError ? (err.body as { code?: string } | undefined)?.code : undefined;
    if (code === "INVALID_PASSWORD") return { fieldErrors: { current: "That password is not correct." } };
    return { error: "We couldn't change your password. Please try again." };
  }
  // Every session ends, this one included, so the farmer signs in once with the new password
  // and knows for certain that no old phone is still signed in.
  await auth.api.signOut({ headers: await headers() });
  await setNotice("password-changed");
  redirect("/farmer/sign-in");
}
