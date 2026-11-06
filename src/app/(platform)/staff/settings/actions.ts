"use server";

import { logError } from "@/lib/log";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { clearForUser } from "@/lib/mfa";
import { requireStaff } from "@/lib/session";
import { normaliseSierraLeonePhone } from "@/lib/phone";
import { setNotice } from "@/lib/pending";
import type { FormState } from "@/lib/auth-flows";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).trim() : "");

/** A staff member's own account. The email is read-only here, as it is for farmers and providers. */
export async function saveStaffAccount(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireStaff();
  const name = str(fd, "name");
  const phone = normaliseSierraLeonePhone(str(fd, "phone"));
  const values = { name, phone: str(fd, "phone") };

  const fieldErrors: Record<string, string> = {};
  if (name.length < 2) fieldErrors.name = "Enter your full name";
  if (!phone) fieldErrors.phone = "Enter a valid Sierra Leone number, for example 76 123 456";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  try {
    await auth.api.updateUser({ body: { name, phone }, headers: await headers() });
  } catch (err) {
    logError("staff.settings", err);
    return { error: "We couldn't save your account details. Please try again.", values };
  }
  revalidatePath("/staff/settings/account");
  return { notice: "Your account details have been saved." };
}

export async function changeStaffPassword(_prev: FormState, fd: FormData): Promise<FormState> {
  const staff = await requireStaff();
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
  // Every session ends, this one included, and the second factor with them: a stolen password
  // must not leave a verified browser behind.
  await clearForUser(staff.id);
  await auth.api.signOut({ headers: await headers() });
  await setNotice("password-changed");
  redirect("/staff/sign-in");
}
