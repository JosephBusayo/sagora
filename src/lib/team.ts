import "server-only";
import { randomBytes, randomUUID, createHash } from "node:crypto";
import { changed, db } from "./db";
import { audit } from "./business";

db.exec(`
CREATE TABLE IF NOT EXISTS team_member (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  user_id TEXT,
  name TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  permission TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited','active','removed')),
  invite_hash TEXT,
  invite_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS team_member_business_email
  ON team_member (business_id, email) WHERE status <> 'removed';
CREATE INDEX IF NOT EXISTS team_member_invite ON team_member (invite_hash);
`);

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
export function ensureOwner(businessId: string, user: { id: string; name: string; email: string; phone?: string | null }) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT OR IGNORE INTO team_member (id, business_id, user_id, name, phone, email, role, permission, status, created_at, updated_at)
     VALUES (?,?,?,?,?,?,'owner','full_access','active',?,?)`,
  ).run(randomUUID(), businessId, user.id, user.name, user.phone ?? "", user.email, now, now);
}

export function listMembers(businessId: string): Member[] {
  const rows = db
    .prepare(
      `SELECT * FROM team_member WHERE business_id=? AND status<>'removed'
       ORDER BY CASE role WHEN 'owner' THEN 0 ELSE 1 END, created_at ASC`,
    )
    .all(businessId) as Row[];
  return rows.map(fromRow);
}

/** Always scoped to the caller's own business, so one provider can never touch another's team. */
export function getMember(businessId: string, id: string): Member | null {
  const r = db.prepare("SELECT * FROM team_member WHERE id=? AND business_id=?").get(id, businessId) as Row | undefined;
  return r ? fromRow(r) : null;
}

export type InviteInput = { name: string; phone: string; email: string; role: string; permission: string };

/** Creates the invited row and returns the one-time token to email. Only the hash is stored. */
export function createInvite(businessId: string, actorId: string, input: InviteInput): { token: string; id: string } | null {
  const now = new Date();
  const token = randomBytes(32).toString("base64url");
  const id = randomUUID();
  try {
    db.prepare(
      `INSERT INTO team_member (id, business_id, name, phone, email, role, permission, status, invite_hash, invite_expires_at, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,'invited',?,?,?,?)`,
    ).run(
      id, businessId, input.name, input.phone, input.email, input.role, input.permission,
      hash(token), new Date(now.getTime() + INVITE_DAYS * 86400000).toISOString(), now.toISOString(), now.toISOString(),
    );
  } catch {
    return null; // already invited or already a member
  }
  audit(actorId, "team.invited", businessId, input.email);
  return { token, id };
}

export function updateMember(businessId: string, actorId: string, id: string, input: InviteInput): boolean {
  const m = getMember(businessId, id);
  if (!m || m.role === "owner") return false; // the owner's own access is not editable here
  const res = db
    .prepare("UPDATE team_member SET name=?, phone=?, email=?, role=?, permission=?, updated_at=? WHERE id=? AND business_id=?")
    .run(input.name, input.phone, input.email, input.role, input.permission, new Date().toISOString(), id, businessId);
  if (changed(res)) audit(actorId, "team.updated", businessId, `${id} ${input.role}/${input.permission}`);
  return changed(res) > 0;
}

export function removeMember(businessId: string, actorId: string, id: string): boolean {
  const m = getMember(businessId, id);
  if (!m || m.role === "owner") return false; // a business always keeps its owner
  const res = db
    .prepare("UPDATE team_member SET status='removed', invite_hash=NULL, updated_at=? WHERE id=? AND business_id=?")
    .run(new Date().toISOString(), id, businessId);
  if (changed(res)) audit(actorId, "team.removed", businessId, m.email);
  return changed(res) > 0;
}

/* ------------------------------------------------------------- accepting */

export type PendingInvite = { member: Member; businessName: string };

/** Looks up an unexpired invite by its token. Returns null for used, expired or unknown tokens. */
export function findInvite(token: string): PendingInvite | null {
  const r = db
    .prepare(
      `SELECT t.*, b.name AS business_name FROM team_member t JOIN provider_business b ON b.id = t.business_id
       WHERE t.invite_hash=? AND t.status='invited'`,
    )
    .get(hash(token)) as (Row & { business_name: string }) | undefined;
  if (!r) return null;
  if (r.invite_expires_at && new Date(r.invite_expires_at) < new Date()) return null;
  return { member: fromRow(r), businessName: r.business_name };
}

/** Links the new account to the invited row and burns the token. */
export function acceptInvite(token: string, userId: string): Member | null {
  const found = findInvite(token);
  if (!found) return null;
  const res = db
    .prepare(
      `UPDATE team_member SET user_id=?, status='active', invite_hash=NULL, invite_expires_at=NULL, updated_at=?
       WHERE id=? AND status='invited'`,
    )
    .run(userId, new Date().toISOString(), found.member.id);
  if (!changed(res)) return null;
  audit(userId, "team.joined", found.member.businessId, found.member.email);
  return { ...found.member, userId, status: "active" };
}

/** The business this signed-in user works for, whether as owner or as an accepted teammate. */
export function membershipFor(userId: string): { businessId: string; role: string; permission: string } | null {
  const r = db
    .prepare("SELECT business_id, role, permission FROM team_member WHERE user_id=? AND status='active' LIMIT 1")
    .get(userId) as { business_id: string; role: string; permission: string } | undefined;
  return r ? { businessId: r.business_id, role: r.role, permission: r.permission } : null;
}
