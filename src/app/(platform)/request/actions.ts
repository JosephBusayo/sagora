"use server";

import { redirect } from "next/navigation";
import { findByCode, forgetGuest, rememberGuest } from "@/lib/guest";
import type { FormState } from "@/lib/auth-flows";

const str = (fd: FormData, k: string) => (typeof fd.get(k) === "string" ? String(fd.get(k)).trim() : "");

/** "Find your request": the tracking code and the phone number it was sent with. */
export async function findRequestAction(_prev: FormState, fd: FormData): Promise<FormState> {
  const values = { code: str(fd, "code"), phone: str(fd, "phone") };
  const fieldErrors: Record<string, string> = {};
  if (!values.code) fieldErrors.code = "Enter your tracking code";
  if (!values.phone) fieldErrors.phone = "Enter the phone number you gave with the request";
  if (Object.keys(fieldErrors).length) return { fieldErrors, values };
  const found = await findByCode(values.code, values.phone);
  if (!found.ok) return { error: found.error, values };
  await rememberGuest(found.requestId);
  redirect("/request/track");
}

/** For a shared phone: this browser stops opening the request. The code still works. */
export async function leaveRequestAction() {
  await forgetGuest();
  redirect("/request/find?left=1");
}
