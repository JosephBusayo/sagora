import { NextResponse } from "next/server";
import { getApprovedBusiness } from "@/lib/business";
import { siteUrl } from "@/lib/site";

/**
 * A provider's own link, to share with their customers. It remembers the provider for a day, so
 * a farmer who has to sign in or sign up first can carry on from Home.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const business = await getApprovedBusiness(id);
  if (!business) return NextResponse.redirect(`${siteUrl()}/farmer/book`);
  const res = NextResponse.redirect(`${siteUrl()}/farmer/book?provider=${business.id}`);
  res.cookies.set("sagora_direct", business.id, { httpOnly: true, sameSite: "lax", secure: true, maxAge: 86400, path: "/" });
  return res;
}
