"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import type { FormState } from "@/lib/auth-flows";
import { completeStaffInvite, findStaffInvite } from "@/lib/staff";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : "");

/** The email and role come from the invite, never the form. */
export async function acceptStaffInviteAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const token = str(fd, "token");
  const invite = await findStaffInvite(token);
  if (!invite) redirect("/staff/join/expired");

  const name = str(fd, "name").trim();
  const password = str(fd, "password");
  const fieldErrors: Record<string, string> = {};
  if (name.length < 2) fieldErrors.name = "Enter your name";
  if (!z.string().min(8).safeParse(password).success) fieldErrors.password = "Use at least 8 characters";
  if (password !== str(fd, "confirm")) fieldErrors.confirm = "Passwords do not match";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values: { name } };

  try {
    const res = await auth.api.signUpEmail({ body: { name, email: invite.email, password }, headers: await headers() });
    await completeStaffInvite(invite.id, res.user.id, invite.role);
  } catch {
    return { error: "We couldn't create your account. Please try again.", values: { name } };
  }
  redirect("/staff/sign-in");
}
