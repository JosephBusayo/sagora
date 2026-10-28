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
  /** Which set of screens the person is in, so verification returns them to the right one. */
  audience: "provider" | "farmer";
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

const NOTICE = "sagora_notice";

/** Set just before a redirect that ends the session, read once on the next page. */
export async function setNotice(value: string) {
  const jar = await cookies();
  jar.set(NOTICE, value, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 });
}

export async function readNotice(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(NOTICE)?.value ?? null;
}
