import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { db } from "./db";
import { audit } from "./business";

/**
 * The company's own people. There is no public way to become staff: an admin invites someone, or
 * an operator with database access runs `npm run staff:make`. An admin can do everything staff
 * can, and also add and remove staff.
 */

export type StaffRole = "staff" | "admin";
export type StaffMember = { id: string; name: string; email: string; role: StaffRole };
export type StaffInvite = { id: string; email: string; name: string; role: StaffRole; expiresAt: string };

const INVITE_DAYS = 7;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export async function listStaff(): Promise<StaffMember[]> {
  return await db.all(`SELECT id, name, email, role FROM "user" WHERE role IN ('staff','admin') ORDER BY name ASC`) as StaffMember[];
}

type InviteRow = { id: string; email: string; name: string; role: StaffRole; expires_at: string };
const fromRow = (r: InviteRow): StaffInvite => ({ id: r.id, email: r.email, name: r.name, role: r.role, expiresAt: r.expires_at });

export async function openInvites(): Promise<StaffInvite[]> {
  const rows = await db.all("SELECT * FROM staff_invite WHERE used_at IS NULL AND expires_at > ? ORDER BY created_at DESC", new Date().toISOString()) as InviteRow[];
  return rows.map(fromRow);
}

export type InviteResult = { ok: true; token: string } | { ok: false; reason: string };

/** Anyone already on Sagora needs a separate address: one email holds one account. */
export async function inviteStaff(adminId: string, input: { email: string; name: string; role: StaffRole }): Promise<InviteResult> {
  const taken = await db.get(`SELECT id FROM "user" WHERE email = ?`, input.email);
  if (taken) return { ok: false, reason: "That email already has a Sagora account. Use a different one." };

  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  await db.tx(async (t) => {
    // A new invite replaces any earlier one to the same address, so an old link stops working.
    await t.run("DELETE FROM staff_invite WHERE email=? AND used_at IS NULL", input.email);
    await t.run(`INSERT INTO staff_invite (id, email, name, role, token_hash, invited_by, expires_at, created_at) VALUES (?,?,?,?,?,?,?,?)`,
      randomUUID(), input.email, input.name, input.role, hash(token), adminId,
      new Date(now.getTime() + INVITE_DAYS * 86400000).toISOString(), now.toISOString());
  });
  await audit(adminId, "staff.invited", input.email, input.role);
  return { ok: true, token };
}

export async function findStaffInvite(token: string): Promise<StaffInvite | null> {
  const r = await db.get("SELECT * FROM staff_invite WHERE token_hash=? AND used_at IS NULL AND expires_at > ?", hash(token), new Date().toISOString()) as InviteRow | undefined;
  return r ? fromRow(r) : null;
}

/** Burns the invite and gives the new account its role. The role comes from the invite, never a form. */
export async function completeStaffInvite(id: string, userId: string, role: StaffRole): Promise<void> {
  await db.tx(async (t) => {
    await t.run("UPDATE staff_invite SET used_at=? WHERE id=?", new Date().toISOString(), id);
    await t.run(`UPDATE "user" SET role=?, "emailVerified"=? WHERE id=?`, role, true, userId);
  });
}

export async function cancelInvite(adminId: string, id: string): Promise<void> {
  const res = await db.run("DELETE FROM staff_invite WHERE id=? AND used_at IS NULL", id);
  if (res.changes) await audit(adminId, "staff.invite_cancelled", id);
}

/** Ends their access at once, on every device. Nobody can remove themselves, so one admin remains. */
export async function removeStaff(adminId: string, userId: string): Promise<boolean> {
  if (adminId === userId) return false;
  const res = await db.tx(async (t) => {
    const r = await t.run(`UPDATE "user" SET role='staff_removed' WHERE id=? AND role IN ('staff','admin')`, userId);
    if (r.changes) await t.run(`DELETE FROM session WHERE "userId"=?`, userId);
    return r;
  });
  if (res.changes) await audit(adminId, "staff.removed", userId);
  return res.changes > 0;
}
