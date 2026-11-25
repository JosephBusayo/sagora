import "server-only";
import { db } from "./db";
import { audit } from "./business";

/**
 * What a super admin can do to any request, provider or farmer (Karim, 23 Nov 2026).
 *
 * Staff coordinate; an admin corrects. Everything here is admin-only — the routes that call it
 * go through requireAdmin() — and every change is written to the audit log, because the whole
 * point of this screen is reaching into somebody else's record.
 *
 * Two rules decided with Karim on 23 Nov 2026, and they are the reason this file exists rather
 * than a handful of loose UPDATE statements:
 *
 *  - **Delete means delete, but only when there is nothing to tear.** A record with quotes, jobs,
 *    payments or ledger entries behind it is refused, and the blockers are named. Removing a paid
 *    request would leave double-entry rows pointing at something that no longer exists, and the
 *    ledger is the one thing in Sagora that must always reconcile. Cancelling or deactivating is
 *    offered instead, which is reversible and keeps the history.
 *  - **Email is never edited here.** It is the login identity, so changing it silently locks a
 *    person out of their own account, and an admin who could repoint an address could take over
 *    any account. The verified email-change flow already exists for that.
 */

/* ------------------------------------------------------------- what blocks a delete */

/** Why a record cannot simply be removed. Empty means it is clean and may go. */
export type Blocker = { what: string; count: number };

const countOf = async (sql: string, ...args: string[]): Promise<number> => {
  const r = await db.get<{ n: number | string }>(sql, ...args);
  return Number(r?.n ?? 0);
};

export async function requestBlockers(id: string): Promise<Blocker[]> {
  const checks: [string, string][] = [
    ["quotes", "SELECT COUNT(*) AS n FROM quote WHERE request_id=?"],
    ["accepted agreements", "SELECT COUNT(*) AS n FROM agreement WHERE request_id=?"],
    ["jobs", "SELECT COUNT(*) AS n FROM job WHERE request_id=?"],
    ["payments", "SELECT COUNT(*) AS n FROM payment WHERE request_id=?"],
    ["bookings", "SELECT COUNT(*) AS n FROM booking WHERE request_id=?"],
    ["ledger entries", "SELECT COUNT(*) AS n FROM ledger_entry WHERE ref_type='request' AND ref_id=?"],
  ];
  const out: Blocker[] = [];
  for (const [what, sql] of checks) {
    const n = await countOf(sql, id);
    if (n > 0) out.push({ what, count: n });
  }
  return out;
}

export async function providerBlockers(businessId: string): Promise<Blocker[]> {
  const checks: [string, string][] = [
    ["quotes sent", "SELECT COUNT(*) AS n FROM quote WHERE business_id=?"],
    ["accepted agreements", "SELECT COUNT(*) AS n FROM agreement WHERE business_id=?"],
    ["jobs", "SELECT COUNT(*) AS n FROM job WHERE business_id=?"],
    ["payout requests", "SELECT COUNT(*) AS n FROM payout_request WHERE business_id=?"],
  ];
  const out: Blocker[] = [];
  for (const [what, sql] of checks) {
    const n = await countOf(sql, businessId);
    if (n > 0) out.push({ what, count: n });
  }
  return out;
}

export async function farmerBlockers(userId: string): Promise<Blocker[]> {
  const n = await countOf("SELECT COUNT(*) AS n FROM service_request WHERE farmer_id=?", userId);
  return n > 0 ? [{ what: "requests", count: n }] : [];
}

export type ActionResult = { ok: true; message: string } | { ok: false; reason: string };

/**
 * "1 quote", not "1 quotes". The blockers are named in the plural because that is how they read
 * most of the time, and the one time they do not is the first thing an admin sees.
 */
const counted = (count: number, what: string): string => {
  if (count !== 1) return `${count} ${what}`;
  const words = what.split(" ");
  const i = words.findIndex((w) => /(ies|s)$/.test(w));
  if (i >= 0) words[i] = words[i].endsWith("ies") ? `${words[i].slice(0, -3)}y` : words[i].slice(0, -1);
  return `1 ${words.join(" ")}`;
};

/** The same sentence everywhere, so an admin learns one rule rather than three. */
const refuse = (noun: string, blockers: Blocker[], instead: string): ActionResult => ({
  ok: false,
  reason: `This ${noun} cannot be deleted: it has ${blockers.map((b) => counted(b.count, b.what)).join(", ")}. ` +
    `Deleting it would leave those records pointing at nothing. ${instead}`,
});

/* --------------------------------------------------------------------- requests */

export type AdminRequest = {
  id: string; reference: string; status: string; service: string; acres: number;
  district: string; chiefdom: string; village: string; preferredDate: string; notes: string;
  contactName: string; contactPhone: string; contactEmail: string;
  farmerId: string | null; createdAt: string;
};

export async function listRequests(q: string, limit = 100): Promise<AdminRequest[]> {
  const like = `%${q.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = await db.all(
    q
      ? `SELECT * FROM service_request WHERE LOWER(reference) LIKE ? ESCAPE '\\' OR LOWER(contact_name) LIKE ? ESCAPE '\\'
           OR LOWER(contact_phone) LIKE ? ESCAPE '\\' OR LOWER(village) LIKE ? ESCAPE '\\'
           ORDER BY created_at DESC LIMIT ?`
      : "SELECT * FROM service_request ORDER BY created_at DESC LIMIT ?",
    ...(q ? [like, like, like, like, limit] : [limit]),
  ) as Record<string, string | number | null>[];
  return rows.map((r) => ({
    id: String(r.id), reference: String(r.reference ?? ""), status: String(r.status ?? ""),
    service: String(r.service ?? ""), acres: Number(r.acres ?? 0), district: String(r.district ?? ""),
    chiefdom: String(r.chiefdom ?? ""), village: String(r.village ?? ""),
    preferredDate: String(r.preferred_date ?? ""), notes: String(r.notes ?? ""),
    contactName: String(r.contact_name ?? ""), contactPhone: String(r.contact_phone ?? ""),
    contactEmail: String(r.contact_email ?? ""), farmerId: r.farmer_id ? String(r.farmer_id) : null,
    createdAt: String(r.created_at ?? ""),
  }));
}

export type RequestEdit = {
  service: string; acres: number; district: string; chiefdom: string; village: string;
  preferredDate: string; notes: string; contactName: string; contactPhone: string;
};

export async function updateRequest(adminId: string, id: string, input: RequestEdit): Promise<ActionResult> {
  // Read first, so the audit entry can name a phone change. Karim's handover asks for
  // "staff-assisted changes recorded" on the guest route, and the phone number is the change that
  // matters: a guest's request is found with its tracking code AND its phone, so moving the number
  // moves who can reach the request. A farmer cannot do it themselves (see the identity check in
  // the booking action); staff can, on a call, and this is the record of it.
  const before = await db.get<{ contact_phone: string; farmer_id: string | null }>(
    "SELECT contact_phone, farmer_id FROM service_request WHERE id=?", id);

  const res = await db.run(
    `UPDATE service_request SET service=?, acres=?, district=?, chiefdom=?, village=?, preferred_date=?,
       notes=?, contact_name=?, contact_phone=?, updated_at=? WHERE id=?`,
    input.service, input.acres, input.district, input.chiefdom, input.village,
    input.preferredDate, input.notes, input.contactName, input.contactPhone, new Date().toISOString(), id);
  if (!res.changes) return { ok: false, reason: "That request no longer exists." };

  const movedPhone = before && before.contact_phone !== input.contactPhone;
  await audit(adminId, "admin.request.updated", id,
    `${input.service} ${input.acres}ac ${input.district}` +
    (movedPhone ? ` · contact number changed from ${before!.contact_phone || "none"} to ${input.contactPhone || "none"}` : ""));
  return {
    ok: true,
    message: movedPhone && before && !before.farmer_id
      ? "Request updated. The contact number changed, so the farmer's tracking code now needs the new number."
      : "Request updated.",
  };
}

export async function deleteRequest(adminId: string, id: string): Promise<ActionResult> {
  const blockers = await requestBlockers(id);
  if (blockers.length) return refuse("request", blockers, "Cancel it instead — that keeps the history and stops providers seeing it.");
  const row = await db.get<{ reference: string }>("SELECT reference FROM service_request WHERE id=?", id);
  if (!row) return { ok: false, reason: "That request no longer exists." };
  // Only rows that belong to the request itself, and only because it has none of the above.
  await db.tx(async (t) => {
    await t.run("DELETE FROM inspection WHERE request_id=?", id);
    await t.run("DELETE FROM request_contact WHERE request_id=?", id);
    await t.run("DELETE FROM service_request WHERE id=?", id);
  });
  await audit(adminId, "admin.request.deleted", id, row.reference);
  return { ok: true, message: `${row.reference} deleted.` };
}

/** The reversible alternative a refusal points at. */
export async function cancelRequestAsAdmin(adminId: string, id: string): Promise<ActionResult> {
  const res = await db.run("UPDATE service_request SET status='cancelled', updated_at=? WHERE id=? AND status <> 'cancelled'",
    new Date().toISOString(), id);
  if (!res.changes) return { ok: false, reason: "That request is already cancelled, or no longer exists." };
  await audit(adminId, "admin.request.cancelled", id);
  return { ok: true, message: "Request cancelled. Providers no longer see it." };
}

/* -------------------------------------------------------------------- providers */

export type AdminProvider = {
  id: string; userId: string; name: string; phone: string; email: string;
  district: string; town: string; description: string; status: string;
};

export async function listProviders(q: string): Promise<AdminProvider[]> {
  const like = `%${q.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = await db.all(
    q
      ? `SELECT id, user_id, name, phone, email, district, town, description, status FROM provider_business
           WHERE LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(email) LIKE ? ESCAPE '\\' OR LOWER(phone) LIKE ? ESCAPE '\\'
           ORDER BY name ASC`
      : "SELECT id, user_id, name, phone, email, district, town, description, status FROM provider_business ORDER BY name ASC",
    ...(q ? [like, like, like] : []),
  ) as { id: string; user_id: string; name: string; phone: string; email: string; district: string; town: string; description: string; status: string }[];
  return rows.map((r) => ({
    id: r.id, userId: r.user_id, name: r.name, phone: r.phone, email: r.email,
    district: r.district, town: r.town, description: r.description, status: r.status,
  }));
}

export type ProviderEdit = { name: string; phone: string; district: string; town: string; description: string };

export async function updateProvider(adminId: string, id: string, input: ProviderEdit): Promise<ActionResult> {
  // Email is deliberately absent: it is the login, and there is a verified flow for changing it.
  const res = await db.run(
    "UPDATE provider_business SET name=?, phone=?, district=?, town=?, description=?, updated_at=? WHERE id=?",
    input.name, input.phone, input.district, input.town, input.description, new Date().toISOString(), id);
  if (!res.changes) return { ok: false, reason: "That business no longer exists." };
  await audit(adminId, "admin.provider.updated", id, input.name);
  return { ok: true, message: "Provider updated." };
}

export async function deleteProvider(adminId: string, id: string): Promise<ActionResult> {
  const blockers = await providerBlockers(id);
  if (blockers.length) return refuse("provider", blockers, "Suspend them instead — they stop receiving requests and the history stays.");
  const row = await db.get<{ name: string; user_id: string }>("SELECT name, user_id FROM provider_business WHERE id=?", id);
  if (!row) return { ok: false, reason: "That business no longer exists." };
  await db.tx(async (t) => {
    const assets = await t.all("SELECT id FROM equipment WHERE business_id=?", id) as { id: string }[];
    for (const a of assets) {
      await t.run("DELETE FROM equipment_fault WHERE equipment_id=?", a.id);
      await t.run("DELETE FROM equipment_photo WHERE equipment_id=?", a.id);
      await t.run("DELETE FROM equipment_photos WHERE equipment_id=?", a.id);
    }
    for (const table of ["equipment", "provider_coverage", "business_document", "payout_destination", "monime_phone_verification", "team_member"]) {
      await t.run(`DELETE FROM ${table} WHERE business_id=?`, id);
    }
    await t.run("DELETE FROM provider_business WHERE id=?", id);
  });
  await audit(adminId, "admin.provider.deleted", id, row.name);
  return { ok: true, message: `${row.name} deleted. Their login still exists; delete it from Farmers & logins if you mean to remove the person too.` };
}

/** The reversible alternative: they keep everything but are shown no new work. */
export async function suspendProvider(adminId: string, id: string): Promise<ActionResult> {
  const res = await db.run("UPDATE provider_business SET status='rejected', review_note=?, updated_at=? WHERE id=?",
    "Suspended by an administrator.", new Date().toISOString(), id);
  if (!res.changes) return { ok: false, reason: "That business no longer exists." };
  await audit(adminId, "admin.provider.suspended", id);
  return { ok: true, message: "Provider suspended. They receive no further requests." };
}

/* ---------------------------------------------------------------------- farmers */

export type AdminFarmer = {
  id: string; name: string; email: string; phone: string; role: string;
  emailVerified: boolean; requests: number;
};

export async function listFarmers(q: string): Promise<AdminFarmer[]> {
  const like = `%${q.toLowerCase().replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const rows = await db.all(
    q
      ? `SELECT id, name, email, phone, role, "emailVerified" FROM "user"
           WHERE role='farmer' AND (LOWER(name) LIKE ? ESCAPE '\\' OR LOWER(email) LIKE ? ESCAPE '\\' OR LOWER(phone) LIKE ? ESCAPE '\\')
           ORDER BY name ASC LIMIT 200`
      : `SELECT id, name, email, phone, role, "emailVerified" FROM "user" WHERE role='farmer' ORDER BY name ASC LIMIT 200`,
    ...(q ? [like, like, like] : []),
  ) as { id: string; name: string; email: string; phone: string | null; role: string; emailVerified: boolean | number | null }[];
  const out: AdminFarmer[] = [];
  for (const r of rows) {
    out.push({
      id: r.id, name: r.name, email: r.email, phone: r.phone ?? "", role: r.role,
      emailVerified: r.emailVerified === true || r.emailVerified === 1,
      requests: await countOf("SELECT COUNT(*) AS n FROM service_request WHERE farmer_id=?", r.id),
    });
  }
  return out;
}

export type FarmerEdit = { name: string; phone: string };

export async function updateFarmer(adminId: string, id: string, input: FarmerEdit): Promise<ActionResult> {
  const res = await db.run(`UPDATE "user" SET name=?, phone=?, "updatedAt"=? WHERE id=? AND role='farmer'`,
    input.name, input.phone, new Date().toISOString(), id);
  if (!res.changes) return { ok: false, reason: "That farmer no longer exists." };
  await audit(adminId, "admin.farmer.updated", id, input.name);
  return { ok: true, message: "Farmer updated." };
}

export async function deleteFarmer(adminId: string, id: string): Promise<ActionResult> {
  const blockers = await farmerBlockers(id);
  if (blockers.length) {
    return refuse("farmer", blockers,
      "Delete or cancel those requests first if they really should go, or leave the account alone.");
  }
  const row = await db.get<{ name: string; email: string }>(`SELECT name, email FROM "user" WHERE id=? AND role='farmer'`, id);
  if (!row) return { ok: false, reason: "That farmer no longer exists." };
  await db.tx(async (t) => {
    await t.run("DELETE FROM notification_read WHERE user_id=?", id);
    await t.run("DELETE FROM notification_outbox WHERE recipient=?", row.email);
    await t.run("DELETE FROM verification WHERE identifier=?", row.email);
    await t.run(`DELETE FROM session WHERE "userId"=?`, id);
    await t.run(`DELETE FROM account WHERE "userId"=?`, id);
    await t.run(`DELETE FROM "user" WHERE id=?`, id);
  });
  await audit(adminId, "admin.farmer.deleted", id, row.email);
  return { ok: true, message: `${row.name || row.email} deleted.` };
}
