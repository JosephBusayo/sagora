"use server";

import { redirect } from "next/navigation";
import { staffAwaitingCode } from "@/lib/session";
import { checkCode, sendCode } from "@/lib/mfa";
import { OTP_LENGTH } from "@/lib/auth";
import type { FormState } from "@/lib/auth-flows";

/** Sends a fresh code to the signed-in staff account's own email. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function sendStaffCode(_prev: FormState, _fd: FormData): Promise<FormState> {
  const { user, sessionId } = await staffAwaitingCode();
  await sendCode(sessionId, user);
  return { notice: `We sent a new code to ${user.email}.` };
}

export async function verifyStaffCode(_prev: FormState, fd: FormData): Promise<FormState> {
  const { sessionId } = await staffAwaitingCode();
  const raw = String(fd.get("code") ?? fd.get("codeFallback") ?? "").replace(/\D/g, "");
  if (raw.length !== OTP_LENGTH) {
    return { fieldErrors: { code: `Enter the ${OTP_LENGTH}-digit code from your email` } };
  }

  const result = await checkCode(sessionId, raw);
  if (!result.ok) return { fieldErrors: { code: result.reason } };
  redirect("/staff/providers");
}
