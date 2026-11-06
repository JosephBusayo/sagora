"use server";

import * as flows from "@/lib/auth-flows";
export type { FormState } from "@/lib/auth-flows";

/** Provider screens. The rules live in lib/auth-flows.ts, shared with the farmer screens. */

export async function signUpProvider(_prev: flows.FormState, fd: FormData) {
  return flows.signUp("provider", fd, "business name");
}
export async function signInProvider(_prev: flows.FormState, fd: FormData) {
  return flows.signIn("provider", fd);
}
export async function requestPasswordReset(_prev: flows.FormState, fd: FormData) {
  return flows.requestPasswordReset("provider", fd);
}
export async function verifyCode(_prev: flows.FormState, fd: FormData) {
  return flows.verifyCode(fd);
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function resendCode(_prev: flows.FormState, _fd: FormData) {
  return flows.resendCode();
}
export async function resetPassword(_prev: flows.FormState, fd: FormData) {
  return flows.resetPassword(fd);
}
export async function signOut() {
  return flows.signOutTo("provider");
}
