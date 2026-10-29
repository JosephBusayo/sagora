import "server-only";
import { db } from "./db";
// Imported for its side effect: the feed reads notification_outbox, and this guarantees that
// table exists however the request reached here.
import "./outbox";

/**
 * The in-app notification list, for both apps.
 *
 * It is **derived from the outbox** rather than written separately. Every notification the
 * product sends already goes through `notify()`, which saves a row before sending; a second
 * table written at the same seventeen call sites would be seventeen chances to forget one, and
 * two lists that disagree. So the feed is the outbox, read by the signed-in person's email.
 *
 * Two things are kept out of it:
 *  - anything carrying a code. The body of a verification or staff sign-in email *is* the
 *    secret; putting it on a screen somebody is already signed into is pointless at best.
 *  - anything the person is not the recipient of. The query is by their own email, always.
 */

db.exec(`
CREATE TABLE IF NOT EXISTS notification_read (
  user_id TEXT NOT NULL,
  notification_id TEXT NOT NULL,
  read_at TEXT NOT NULL,
  PRIMARY KEY (user_id, notification_id)
);
CREATE INDEX IF NOT EXISTS notification_read_user ON notification_read (user_id);
`);

/** Kinds that must never appear on screen, because their body is a credential. */
const SECRET_KINDS = ["otp", "staff.mfa", "verification", "reset"];
const secretFilter = SECRET_KINDS.map(() => "o.kind NOT LIKE ? || '%'").join(" AND ");

/**
 * What each kind is called on screen, and which icon it gets. An unknown kind still shows —
 * with its subject, which is always written for a human — rather than being hidden.
 */
const KINDS: Record<string, { label: string; icon: string; href?: (ref: string) => string }> = {
  "request.created": { label: "Request sent", icon: "requests" },
  "quote.sent": { label: "New quote", icon: "quotes" },
  "quote.revised": { label: "Quote revised", icon: "quotes" },
  "quote.accepted": { label: "Quote accepted", icon: "quotes" },
  "job.work_reported": { label: "Work reported", icon: "jobs" },
  "job.confirmed": { label: "Work confirmed", icon: "jobs" },
  "job.concern": { label: "Concern raised", icon: "jobs" },
  "booking.confirmed": { label: "Booking confirmed", icon: "payments" },
  "payout.sent": { label: "Payment sent", icon: "payments" },
  "refund.sent": { label: "Refund sent", icon: "payments" },
  "team.invited": { label: "Team invitation", icon: "team" },
  "business.approved": { label: "Business approved", icon: "store" },
  "business.changes_requested": { label: "Changes requested", icon: "store" },
  "business.rejected": { label: "Business not approved", icon: "store" },
};

export type Notification = {
  id: string; subject: string; body: string; kind: string;
  label: string; icon: string; at: string; read: boolean; delivered: boolean;
};

export type Filter = "all" | "unread";

export const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "unread", label: "Unread" },
];

type Row = {
  id: string; subject: string; body: string; kind: string; created_at: string;
  status: string; read_at: string | null;
};

function toNotification(r: Row): Notification {
  const known = KINDS[r.kind];
  return {
    id: r.id,
    subject: r.subject,
    body: r.body,
    kind: r.kind,
    label: known?.label ?? "Update",
    icon: known?.icon ?? "info",
    at: r.created_at,
    read: r.read_at !== null,
    // Worth showing: a notification the farmer is reading here may never have reached their inbox.
    delivered: r.status === "sent",
  };
}

const LIMIT = 50;

export function listFor(user: { id: string; email: string }, filter: Filter = "all"): Notification[] {
  const rows = db
    .prepare(
      `SELECT o.id, o.subject, o.body, o.kind, o.created_at, o.status, r.read_at
       FROM notification_outbox o
       LEFT JOIN notification_read r ON r.notification_id = o.id AND r.user_id = ?
       WHERE o.recipient = ? AND ${secretFilter}
         ${filter === "unread" ? "AND r.read_at IS NULL" : ""}
       ORDER BY o.created_at DESC
       LIMIT ${LIMIT}`,
    )
    .all(user.id, user.email, ...SECRET_KINDS) as Row[];
  return rows.map(toNotification);
}

export function unreadCount(user: { id: string; email: string }): number {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM notification_outbox o
       LEFT JOIN notification_read r ON r.notification_id = o.id AND r.user_id = ?
       WHERE o.recipient = ? AND r.read_at IS NULL AND ${secretFilter}`,
    )
    .get(user.id, user.email, ...SECRET_KINDS) as { n: number };
  return Number(row.n);
}

/** Marks one as read. The id is checked against this person's own mail, not trusted from a form. */
export function markRead(user: { id: string; email: string }, notificationId: string): boolean {
  const owned = db
    .prepare("SELECT 1 AS ok FROM notification_outbox WHERE id=? AND recipient=?")
    .get(notificationId, user.email) as { ok: number } | undefined;
  if (!owned) return false;
  db.prepare("INSERT OR IGNORE INTO notification_read (user_id, notification_id, read_at) VALUES (?,?,?)")
    .run(user.id, notificationId, new Date().toISOString());
  return true;
}

export function markAllRead(user: { id: string; email: string }): number {
  const rows = db
    .prepare(
      `SELECT o.id FROM notification_outbox o
       LEFT JOIN notification_read r ON r.notification_id = o.id AND r.user_id = ?
       WHERE o.recipient = ? AND r.read_at IS NULL AND ${secretFilter}`,
    )
    .all(user.id, user.email, ...SECRET_KINDS) as { id: string }[];
  const now = new Date().toISOString();
  const insert = db.prepare("INSERT OR IGNORE INTO notification_read (user_id, notification_id, read_at) VALUES (?,?,?)");
  for (const r of rows) insert.run(user.id, r.id, now);
  return rows.length;
}
