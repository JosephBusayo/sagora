import "server-only";
import { isStaffRole } from "./audience";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { isVerified } from "./mfa";

type SessionUser = { id: string; name: string; email: string; emailVerified: boolean; role?: string | null; phone?: string | null; businessName?: string | null };

/** Verified provider, or redirect to sign-in. Every provider page and action starts here. */
export async function requireProvider(): Promise<SessionUser> {
  const s = await auth.api.getSession({ headers: await headers() });
  const u = s?.user as SessionUser | undefined;
  if (!u || !u.emailVerified) redirect("/provider/sign-in");
  if (isStaffRole(u.role)) redirect("/staff/providers");
  if (u.role === "farmer") redirect("/farmer/home"); // a farmer account has no provider workspace
  return u;
}

/** Verified farmer, or redirect to the farmer sign-in. */
export async function requireFarmer(): Promise<SessionUser> {
  const s = await auth.api.getSession({ headers: await headers() });
  const u = s?.user as SessionUser | undefined;
  if (!u || !u.emailVerified) redirect("/farmer/sign-in");
  if (u.role !== "farmer") redirect(isStaffRole(u.role) ? "/staff/providers" : "/provider/setup");
  return u;
}

/**
 * Staff only, and only once this browser has proved a second factor.
 *
 * Anyone who is not staff is sent to sign-in without being told the page exists. Staff who have
 * not passed the emailed code go to /staff/verify. The brief asks for MFA on staff and finance
 * roles, and these screens move money.
 */
export async function requireStaff(): Promise<SessionUser> {
  const s = await auth.api.getSession({ headers: await headers() });
  const u = s?.user as SessionUser | undefined;
  if (!u || !u.emailVerified || !isStaffRole(u.role)) redirect("/provider/sign-in");
  if (!(await isVerified(s!.session.id))) redirect("/staff/verify");
  return u;
}

/** An admin has passed everything staff have, and may also add and remove staff. */
export async function requireAdmin(): Promise<SessionUser> {
  const u = await requireStaff();
  if (u.role !== "admin") redirect("/staff/providers");
  return u;
}

/** Staff identity only, without the second factor — for the verify screen itself. */
export async function staffAwaitingCode(): Promise<{ user: SessionUser; sessionId: string }> {
  const s = await auth.api.getSession({ headers: await headers() });
  const u = s?.user as SessionUser | undefined;
  if (!u || !u.emailVerified || !isStaffRole(u.role)) redirect("/provider/sign-in");
  return { user: u, sessionId: s!.session.id };
}

/** The current session's id, for ending the second factor on sign-out. */
export async function currentSessionId(): Promise<string | null> {
  const s = await auth.api.getSession({ headers: await headers() });
  return s?.session.id ?? null;
}

/** True when a sign-in cookie came with the visit but no longer opens a session. */
export async function sessionExpired(): Promise<boolean> {
  const jar = await cookies();
  if (!jar.has("better-auth.session_token") && !jar.has("__Secure-better-auth.session_token")) return false;
  return !(await auth.api.getSession({ headers: await headers() }));
}
