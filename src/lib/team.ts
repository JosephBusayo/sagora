import "server-only";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { db } from "./db";
import { audit } from "./business";

/** Roles and permissions come from the Team design's two dropdowns. */
export const ROLES = [
  { id: "owner", label: "Owner" },
  { id: "operator", label: "Operator" },
  { id: "assistant", label: "Assistant" },
] as const;

export const PERMISSIONS = [
  { id: "full_access", label: "Full access" },
  { id: "manage_jobs", label: "Manage jobs" },
  { id: "view_jobs", label: "View jobs" },
] as const;

export const roleLabel = (id: string) => ROLES.find((r) => r.id === id)?.label ?? id;
export const permissionLabel = (id: string) => PERMISSIONS.find((p) => p.id === id)?.label ?? id;

export type MemberStatus = "invited" | "active" | "removed";
export type Member = {
  id: string; businessId: string; userId: string | null; name: string; phone: string; email: string;
  role: string; permission: string; status: MemberStatus; inviteExpiresAt: string | null;
};

type Row = {
  id: string; business_id: string; user_id: string | null; name: string; phone: string; email: string;
  role: string; permission: string; status: MemberStatus; invite_expires_at: string | null;
};
const fromRow = (r: Row): Member => ({
  id: r.id, businessId: r.business_id, userId: r.user_id, name: r.name, phone: r.phone, email: r.email,
  role: r.role, permission: r.permission, status: r.status, inviteExpiresAt: r.invite_expires_at,
});

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const INVITE_DAYS = 7;

/** The owner row is created once, from the business itself, so the table is never empty. */
export async function ensureOwner(businessId: string, user: { id: string; name: string; email: string; phone?: string | null }) {
  const now = new Date().toISOString();
  await db.run(`INSERT INTO team_member (id, business_id, user_id, name, phone, email, role, permission, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'owner','full_access','active',?,?)
     ON CONFLICT DO NOTHING`, randomUUID(), businessId, user.id, user.name, user.phone ?? "", user.email, now, now);
}

export async function listMembers(businessId: string): Promise<Member[]> {
  const rows = await db.all(`SELECT * FROM team_member WHERE business_id=? AND status<>'removed'
       ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at ASC`, businessId) as Row[];
  return rows.map(fromRow);
}

/** Always scoped to the caller's own business, so one provider can never touch another's team. */
export async function getMember(businessId: string, id: string): Promise<Member | null> {
  const r = await db.get("SELECT * FROM team_member WHERE id=? AND business_id=?", id, businessId) as Row | undefined;
  return r ? fromRow(r) : null;
}

export type InviteInput = { name: string; phone: string; email: string; role: string; permission: string };

/** Creates the invited row and returns the one-time token to email. Only the hash is stored. */
export async function createInvite(businessId: string, actorId: string, input: InviteInput): Promise<{ token: string; id: string } | null> {
  const now = new Date();
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  try {
    await db.run(`INSERT INTO team_member (id, business_id, name, phone, email, role, permission, status, invite_hash, invite_expires_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,'invited',?,?,?,?)`, id, businessId, input.name, input.phone, input.email, input.role, input.permission,
      hash(token), new Date(now.getTime() + INVITE_DAYS * 86400000).toISOString(), now.toISOString(), now.toISOString(),);
  } catch {
    return null; // already invited or already a member
  }
  await audit(actorId, "team.invited", businessId, input.email);
  return { token, id };
}

export async function updateMember(businessId: string, actorId: string, id: string, input: InviteInput): Promise<boolean> {
  const m = await getMember(businessId, id);
  if (!m || m.role === "owner") return false; // the owner's own access is not editable here
  const res = await db.run("UPDATE team_member SET name=?, phone=?, email=?, role=?, permission=?, updated_at=? WHERE id=? AND business_id=?", input.name, input.phone, input.email, input.role, input.permission, new Date().toISOString(), id, businessId);
  if (res.changes) await audit(actorId, "team.updated", businessId, `${id} ${input.role}/${input.permission}`);
  return res.changes > 0;
}

export async function removeMember(businessId: string, actorId: string, id: string): Promise<boolean> {
  const m = await getMember(businessId, id);
  if (!m || m.role === "owner") return false; // a business always keeps its owner
  const res = await db.run("UPDATE team_member SET status='removed', invite_hash=NULL, updated_at=? WHERE id=? AND business_id=?", new Date().toISOString(), id, businessId);
  if (res.changes) await audit(actorId, "team.removed", businessId, m.email);
  return res.changes > 0;
}

/* ------------------------------------------------------------- accepting */

export type PendingInvite = { member: Member; businessName: string };

/** Looks up an unexpired invite by its token. Returns null for used, expired or unknown tokens. */
export async function findInvite(token: string): Promise<PendingInvite | null> {
  const r = await db.get(`SELECT t.*, b.name AS business_name FROM team_member t JOIN provider_business b ON b.id = t.business_id
       WHERE t.invite_hash=? AND t.status='invited'`, hash(token)) as (Row & { business_name: string }) | undefined;
  if (!r) return null;
  if (r.invite_expires_at && new Date(r.invite_expires_at) < new Date()) return null;
  return { member: fromRow(r), businessName: r.business_name };
}

/** Links the new account to the invited row and burns the token. */
export async function acceptInvite(token: string, userId: string): Promise<Member | null> {
  const found = await findInvite(token);
  if (!found) return null;
  const res = await db.run(`UPDATE team_member SET user_id=?, status='active', invite_hash=NULL, invite_expires_at=NULL, updated_at=?
       WHERE id=? AND status='invited'`, userId, new Date().toISOString(), found.member.id);
  if (!res.changes) return null;
  await audit(userId, "team.joined", found.member.businessId, found.member.email);
  return { ...found.member, userId, status: "active" };
}

/** The business this signed-in user works for, whether as owner or as an accepted teammate. */
export async function membershipFor(userId: string): Promise<{ businessId: string; role: string; permission: string } | null> {
  const r = await db.get("SELECT business_id, role, permission FROM team_member WHERE user_id=? AND status='active' LIMIT 1", userId) as { business_id: string; role: string; permission: string } | undefined;
  return r ? { businessId: r.business_id, role: r.role, permission: r.permission } : null;
}
