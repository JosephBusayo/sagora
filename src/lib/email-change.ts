import "server-only";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { auth, OTP_LENGTH } from "./auth";
import { codeOf, isRateLimited, otpMessage, type FormState } from "./auth-flows";
import { audit } from "./business";
import { db } from "./db";
import { flash } from "./flash";
import { logError } from "./log";
import { notify } from "./outbox";
/** All a change needs to know about the person. */
type SessionUser = { id: string; email: string };

/**
 * Changing the sign-in email, for farmers, providers and staff alike. Two steps: the new address
 * and the current password, then the code sent to the new address. Nothing changes until that
 * code is entered, so a typo in the address cannot lock anyone out.
 */

const COOKIE = "sagora_email_change";
const TEN_MINUTES = 600;
const emailSchema = z.string().trim().toLowerCase().pipe(z.email("Enter a valid email address"));
const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)) : "");

/** The address waiting for its code, if this person started a change in this browser. */
export async function pendingEmailChange(user: SessionUser): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { userId?: string; newEmail?: string };
    return v.userId === user.id && v.newEmail ? v.newEmail : null;
  } catch {
    return null;
  }
}

async function remember(user: SessionUser, newEmail: string) {
  (await cookies()).set(COOKIE, JSON.stringify({ userId: user.id, newEmail }), {
    path: "/", maxAge: TEN_MINUTES, httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production",
  });
}

async function sendCode(newEmail: string) {
  await auth.api.requestEmailChangeEmailOTP({ body: { newEmail }, headers: await headers() });
}

/** Step one. On success it goes on to the code screen at `codeHref`. */
export async function startEmailChange(user: SessionUser, fd: FormData, codeHref: string): Promise<FormState> {
  const typed = str(fd, "email").trim();
  const password = str(fd, "password");
  const values = { email: typed };

  const fieldErrors: Record<string, string> = {};
  const parsed = emailSchema.safeParse(typed);
  if (!parsed.success) fieldErrors.email = "Enter a valid email address";
  else if (parsed.data === user.email.toLowerCase()) fieldErrors.email = "This is already your email address";
  if (!password) fieldErrors.password = "Enter your current password";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };
  const newEmail = parsed.data!;

  try {
    await auth.api.verifyPassword({ body: { password }, headers: await headers() });
  } catch (err) {
    if (codeOf(err) === "INVALID_PASSWORD") return { fieldErrors: { password: "That password is not correct." }, values };
    logError("email-change.password", err);
    return { error: "We couldn't check your password. Please try again.", values };
  }

  // Said plainly: the person has just proved who they are, and a code that never arrives helps nobody.
  const taken = await db.get(`SELECT 1 AS x FROM "user" WHERE lower(email) = ?`, newEmail);
  if (taken) return { fieldErrors: { email: "Another Sagora account already uses this email address." }, values };

  try {
    await sendCode(newEmail);
  } catch (err) {
    if (isRateLimited(err)) return { error: "Please wait a minute before asking for another code.", values };
    logError("email-change.request", err);
    return { error: "We couldn't send a code. Please try again shortly.", values };
  }
  await remember(user, newEmail);
  redirect(codeHref);
}

export async function resendEmailChange(user: SessionUser): Promise<FormState> {
  const newEmail = await pendingEmailChange(user);
  if (!newEmail) return { error: "Start again: enter your new email address." };
  try {
    await sendCode(newEmail);
  } catch (err) {
    if (isRateLimited(err)) return { error: "Please wait a minute before asking for another code." };
    return { error: "We couldn't send a new code. Please try again shortly." };
  }
  await remember(user, newEmail);
  return { notice: "A new code is on its way." };
}

/** Step two. On success the person lands back on their account page at `doneHref`. */
export async function confirmEmailChange(user: SessionUser, fd: FormData, doneHref: string, startHref: string): Promise<FormState> {
  const newEmail = await pendingEmailChange(user);
  if (!newEmail) redirect(startHref);
  const code = (str(fd, "code") || str(fd, "codeFallback")).replace(/\D/g, "");
  if (code.length !== OTP_LENGTH) return { fieldErrors: { code: `Enter the ${OTP_LENGTH}-digit code from your email` } };

  try {
    await auth.api.changeEmailEmailOTP({ body: { newEmail, otp: code }, headers: await headers() });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/already in use/i.test(message)) return { error: "Another Sagora account now uses this email address. Start again with a different one." };
    return { fieldErrors: { code: otpMessage(err) } };
  }

  const now = new Date().toISOString();
  // Copies of the address kept elsewhere follow it, so updates about requests and teams reach the new one.
  await db.run("UPDATE service_request SET contact_email=?, updated_at=? WHERE farmer_id=?", newEmail, now, user.id);
  await db.run(`UPDATE team_member SET email=?, updated_at=? WHERE user_id=? AND status <> 'removed'
      AND NOT EXISTS (SELECT 1 FROM team_member o WHERE o.business_id = team_member.business_id AND o.email = ? AND o.status <> 'removed' AND o.id <> team_member.id)`,
    newEmail, now, user.id, newEmail);
  await audit(user.id, "account.email_changed", user.id, `${user.email} -> ${newEmail}`);
  // The old address hears about it, so a change nobody asked for does not go unnoticed.
  await notify({
    kind: "account.email_changed",
    dedupeKey: `account.email_changed:${user.id}:${now}`,
    to: user.email,
    subject: "Your Sagora email address was changed",
    text:
      `The email address on your Sagora account was changed to ${newEmail}.\n\n` +
      `From now on, sign in with the new address. If you did not make this change, contact Sagora straight away.`,
  });
  (await cookies()).delete(COOKIE);
  await flash("Your email address has been changed.");
  redirect(doneHref);
}
