"use server";

import * as flows from "@/lib/auth-flows";
export type { FormState } from "@/lib/auth-flows";

/** Farmer screens. Same rules as the provider screens; see lib/auth-flows.ts. */

export async function signUpFarmer(_prev: flows.FormState, fd: FormData) {
  return flows.signUp("farmer", fd, "first and last name");
}
export async function signInFarmer(_prev: flows.FormState, fd: FormData) {
  return flows.signIn("farmer", fd);
}
export async function requestFarmerPasswordReset(_prev: flows.FormState, fd: FormData) {
  return flows.requestPasswordReset("farmer", fd);
}
export async function verifyFarmerCode(_prev: flows.FormState, fd: FormData) {
  return flows.verifyCode(fd);
}
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function resendFarmerCode(_prev: flows.FormState, _fd: FormData) {
  return flows.resendCode();
}
export async function resetFarmerPassword(_prev: flows.FormState, fd: FormData) {
  return flows.resetPassword(fd);
}
export async function signOutFarmer() {
  return flows.signOutTo("farmer");
}
