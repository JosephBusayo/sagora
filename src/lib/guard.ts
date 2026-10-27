import "server-only";
import { redirect } from "next/navigation";
import { ensureBusiness, getBusinessForUser, type Business } from "./business";
import { ensureOwner, membershipFor } from "./team";
import { requireProvider } from "./session";

export type Workspace = {
  user: { id: string; name: string; email: string; phone?: string | null; businessName?: string | null };
  business: Business;
  role: string;
  permission: string;
};

/**
 * Everything inside the provider workspace goes through here: a verified account,
 * a business that Sagora has approved, and a membership that says which business.
 * An unapproved provider is sent back to setup, never into the workspace.
 */
export async function requireWorkspace(): Promise<Workspace> {
  const user = await requireProvider();

  // A teammate who accepted an invite belongs to someone else's business.
  const member = membershipFor(user.id);
  if (member) {
    const { db } = await import("./db");
    const row = db.prepare("SELECT * FROM provider_business WHERE id = ?").get(member.businessId) as { user_id: string } | undefined;
    if (row) {
      const owned = getBusinessForUser(row.user_id)!;
      if (owned.status !== "approved") redirect("/provider/setup");
      return { user, business: owned, role: member.role, permission: member.permission };
    }
  }

  const business = ensureBusiness(user);
  if (business.status !== "approved") redirect("/provider/setup");
  ensureOwner(business.id, user);
  return { user, business, role: "owner", permission: "full_access" };
}
