"use server";

import { signInStaff, type FormState } from "@/lib/auth-flows";

export async function signInStaffAction(_prev: FormState, fd: FormData): Promise<FormState> {
  return signInStaff(fd);
}
