"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { APIError } from "better-auth/api";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { audit } from "@/lib/business";
import { db } from "@/lib/db";
import { requireWorkspace } from "@/lib/guard";
import { normaliseSierraLeonePhone } from "@/lib/phone";
import { setNotice } from "@/lib/pending";
import type { FormState } from "@/app/provider/actions";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).trim() : "");

const emailSchema = z.string().toLowerCase().pipe(z.email("Enter a valid email address"));

/* ------------------------------------------------------- business details */

export async function saveBusinessDetails(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user, business, permission } = await requireWorkspace();
  if (permission !== "full_access") return { error: "You do not have permission to change business details." };

  const name = str(fd, "name");
  const email = str(fd, "email");
  const town = str(fd, "town");
  const description = str(fd, "description");
  const phone = normaliseSierraLeonePhone(str(fd, "phone"));
  const values = { name, phone: str(fd, "phone"), email, town, description };

  const fieldErrors: Record<string, string> = {};
  if (name.length < 2) fieldErrors.name = "Enter your business name";
  if (!phone) fieldErrors.phone = "Enter a valid Sierra Leone number, for example 76 123 456";
  if (!emailSchema.safeParse(email).success) fieldErrors.email = "Enter a valid email address";
  if (town.length < 2) fieldErrors.town = "Enter your village or town";
  if (description.length > 500) fieldErrors.description = "Use 500 characters or fewer";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  db.prepare("UPDATE provider_business SET name=?, phone=?, email=?, town=?, description=?, updated_at=? WHERE id=?")
    .run(name, phone, email.toLowerCase(), town, description, new Date().toISOString(), business.id);
  audit(user.id, "business.details_updated", business.id);
  revalidatePath("/provider/settings/business");
  return { notice: "Your business details have been saved." };
}

/* ---------------------------------------------------------------- account */

export async function saveAccount(_prev: FormState, fd: FormData): Promise<FormState> {
  const { user } = await requireWorkspace();
  const name = str(fd, "name");
  const phone = normaliseSierraLeonePhone(str(fd, "phone"));
  const values = { name, phone: str(fd, "phone") };

  const fieldErrors: Record<string, string> = {};
  if (name.length < 2) fieldErrors.name = "Enter your full name";
  if (!phone) fieldErrors.phone = "Enter a valid Sierra Leone number, for example 76 123 456";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };

  try {
    await auth.api.updateUser({ body: { name, phone }, headers: await headers() });
  } catch {
    return { error: "We couldn't save your account details. Please try again.", values };
  }
  // The email address is deliberately read-only here: changing it has to re-verify,
  // which is a separate flow in the brief and is not designed yet.
  db.prepare("UPDATE team_member SET name=?, phone=?, updated_at=? WHERE user_id=?")
    .run(name, phone, new Date().toISOString(), user.id);
  revalidatePath("/provider/settings/account");
  return { notice: "Your account details have been saved." };
}

/* --------------------------------------------------------------- password */

export async function changePassword(_prev: FormState, fd: FormData): Promise<FormState> {
  await requireWorkspace();
  const current = String(fd.get("current") ?? "");
  const password = String(fd.get("password") ?? "");
  const confirm = String(fd.get("confirm") ?? "");

  const fieldErrors: Record<string, string> = {};
  if (!current) fieldErrors.current = "Enter your current password";
  if (password.length < 8) fieldErrors.password = "Use at least 8 characters";
  if (password !== confirm) fieldErrors.confirm = "Passwords do not match";
  if (Object.keys(fieldErrors).length) return { fieldErrors };

  try {
    // Other browsers are signed out, as the brief requires after a password change.
    await auth.api.changePassword({
      body: { currentPassword: current, newPassword: password, revokeOtherSessions: true },
      headers: await headers(),
    });
  } catch (err) {
    const code = err instanceof APIError ? (err.body as { code?: string } | undefined)?.code : undefined;
    if (code === "INVALID_PASSWORD") return { fieldErrors: { current: "That password is not correct." } };
    return { error: "We couldn't change your password. Please try again." };
  }
  // Every session ends, including this one, so the person signs in once with the new
  // password and knows for certain that no old device is still signed in.
  await auth.api.signOut({ headers: await headers() });
  await setNotice("password-changed");
  redirect("/provider/sign-in");
}
