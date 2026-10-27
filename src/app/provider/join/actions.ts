"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { acceptInvite, findInvite } from "@/lib/team";
import type { FormState } from "../actions";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : "");

/**
 * Creates the teammate's account from the invite and links it to the right business.
 * The invited email is taken from the invite, never from the form, so an invite can
 * only ever create the account it was sent to.
 */
export async function acceptInviteAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const token = str(fd, "token");
  const invite = findInvite(token);
  if (!invite) redirect("/provider/join/expired");

  const password = str(fd, "password");
  const confirm = str(fd, "confirm");
  const name = str(fd, "name").trim() || invite.member.name;

  const fieldErrors: Record<string, string> = {};
  if (!z.string().min(8).safeParse(password).success) fieldErrors.password = "Use at least 8 characters";
  if (password !== confirm) fieldErrors.confirm = "Passwords do not match";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values: { name } };

  let userId: string;
  const existing = db.prepare("SELECT id FROM user WHERE email = ?").get(invite.member.email) as { id: string } | undefined;
  if (existing) {
    // Already has a Sagora account: just join, no new account and no password change.
    userId = existing.id;
  } else {
    try {
      const res = await auth.api.signUpEmail({
        body: { name, email: invite.member.email, password, phone: invite.member.phone, businessName: invite.businessName },
        headers: await headers(),
      });
      userId = res.user.id;
    } catch {
      return { error: "We couldn't create your account. Please try again.", values: { name } };
    }
    // The invite link proves they received the email, so the address is already confirmed.
    db.prepare("UPDATE user SET emailVerified = 1 WHERE id = ?").run(userId);
  }

  if (!acceptInvite(token, userId)) redirect("/provider/join/expired");
  redirect("/provider/sign-in?joined=1");
}
