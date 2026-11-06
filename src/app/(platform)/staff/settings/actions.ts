"use server";

import { logError } from "@/lib/log";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { APIError } from "better-auth/api";
import { auth } from "@/lib/auth";
import { clearForUser } from "@/lib/mfa";
import { requireAdmin, requireStaff } from "@/lib/session";
import { monimeConfigured, monimeTestMode, registerWebhook } from "@/lib/monime";
import { siteUrl } from "@/lib/site";
import { audit } from "@/lib/business";
import { normaliseSierraLeonePhone } from "@/lib/phone";
import { confirmEmailChange, resendEmailChange, startEmailChange } from "@/lib/email-change";
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

/* ----------------------------------------------------------- change email */

export async function startEmailChangeAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireStaff();
  return startEmailChange(user, fd, "/staff/settings/email?step=code");
}

export async function resendEmailChangeAction(): Promise<FormState> {
  const user = await requireStaff();
  return resendEmailChange(user);
}

export async function confirmEmailChangeAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const user = await requireStaff();
  return confirmEmailChange(user, fd, "/staff/settings/account", "/staff/settings/email");
}

/* -------------------------------------------------------- online payments */

/** Registers Sagora's notice address with Monime, using the keys that only the live site holds. */
export async function connectMonimeAction() {
  const admin = await requireAdmin();
  const secret = process.env.MONIME_WEBHOOK_SECRET?.trim();
  if (!monimeConfigured() || !secret) redirect(`/staff/settings/payments?err=${encodeURIComponent("Monime is not set up yet.")}`);
  if (monimeTestMode()) redirect(`/staff/settings/payments?err=${encodeURIComponent("Monime only sets up payment notices for a live token.")}`);
  let done = "";
  try {
    const how = await registerWebhook(`${siteUrl()}/api/monime/webhook`, secret!);
    done = how === "created" ? "Payment notices are set up." : "Payment notices were already set up and have been refreshed.";
  } catch (err) {
    logError("monime.webhook-setup", err);
    redirect(`/staff/settings/payments?err=${encodeURIComponent("Monime refused the request. Check the token can manage webhooks, then try again.")}`);
  }
  await audit(admin.id, "monime.webhook_registered", admin.id, siteUrl());
  redirect(`/staff/settings/payments?done=${encodeURIComponent(done)}`);
}
