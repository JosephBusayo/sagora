import "server-only";
import { cookies } from "next/headers";

/**
 * Short-lived, httpOnly cookie that carries the email address (and, during a password
 * reset, the already-checked code) between the verify-email and reset-password screens.
 * It keeps the address out of the URL.
 */
export type Pending = {
  email: string;
  purpose: "verify" | "reset";
  /** Set after a reset code has been checked, so the reset step can use it. */
  code?: string;
};

const NAME = "sagora_pending";
const MAX_AGE_SECONDS = 15 * 60;

export async function setPending(value: Pending) {
  (await cookies()).set(NAME, JSON.stringify(value), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export async function getPending(): Promise<Pending | null> {
  const raw = (await cookies()).get(NAME)?.value;
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Pending;
    if (typeof v.email === "string" && (v.purpose === "verify" || v.purpose === "reset")) return v;
  } catch {
    /* fall through */
  }
  return null;
}

export async function clearPending() {
  (await cookies()).delete(NAME);
}
