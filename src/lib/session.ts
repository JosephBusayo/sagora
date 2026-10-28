import "server-only";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";

type SessionUser = { id: string; name: string; email: string; emailVerified: boolean; role?: string | null; phone?: string | null; businessName?: string | null };

/** Verified provider, or redirect to sign-in. Every provider page and action starts here. */
export async function requireProvider(): Promise<SessionUser> {
  const s = await auth.api.getSession({ headers: await headers() });
  const u = s?.user as SessionUser | undefined;
  if (!u || !u.emailVerified) redirect("/provider/sign-in");
  if (u.role === "staff") redirect("/staff/providers");
  if (u.role === "farmer") redirect("/farmer/home"); // a farmer account has no provider workspace
  return u;
}

/** Verified farmer, or redirect to the farmer sign-in. */
export async function requireFarmer(): Promise<SessionUser> {
  const s = await auth.api.getSession({ headers: await headers() });
  const u = s?.user as SessionUser | undefined;
  if (!u || !u.emailVerified) redirect("/farmer/sign-in");
  if (u.role !== "farmer") redirect(u.role === "staff" ? "/staff/providers" : "/provider/setup");
  return u;
}

/** Staff only. Anyone else is sent away without being told the page exists. */
export async function requireStaff(): Promise<SessionUser> {
  const s = await auth.api.getSession({ headers: await headers() });
  const u = s?.user as SessionUser | undefined;
  if (!u || !u.emailVerified || u.role !== "staff") redirect("/provider/sign-in");
  return u;
}
