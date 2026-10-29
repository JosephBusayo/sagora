import "server-only";
import { randomUUID } from "node:crypto";
import { changed, db } from "./db";
import { sendEmail } from "./email";

/**
 * The notification outbox.
 *
 * Brief rule: "events are saved first, then sent with retries and duplicate protection.
 * Saving a request/quote/payment must never depend on email delivery. Failed sends show in a
 * staff queue with an owner."
 *
 * So writing a notification is a plain database insert inside the caller's own work. Sending
 * happens afterwards and can fail, retry, or end up in the staff queue, without ever rolling
 * back the thing that caused it.
 */

/** Give up after this many tries and hand it to the staff queue. */
const MAX_ATTEMPTS = 5;

export type Message = {
  to: string;
  subject: string;
  text: string;
  /** What kind of event this is, for the staff queue: "verification", "quote.sent", … */
  kind: string;
  /**
   * Optional. If two events would send the same message twice — a retried form post, a
   * duplicate webhook — give them the same key and only the first is stored.
   */
  dedupeKey?: string;
};

/**
 * Saves the message. Never sends, never throws for delivery reasons, so callers can treat it
 * as part of their own transaction. Returns null when the dedupe key was already used.
 */
export function enqueue(message: Message): string | null {
  const id = randomUUID();
  const now = new Date().toISOString();
  try {
    db.prepare(
      `INSERT INTO notification_outbox (id, recipient, subject, body, kind, dedupe_key, next_attempt_at, created_at)
       VALUES (?,?,?,?,?,?,?,?)`,
    ).run(id, message.to, message.subject, message.text, message.kind, message.dedupeKey ?? null, now, now);
    return id;
  } catch {
    return null; // duplicate key: the message is already queued or sent
  }
}

type Row = { id: string; recipient: string; subject: string; body: string; attempts: number };

/** Minutes to wait before trying again: 1, 2, 4, 8, 16. */
const backoffMinutes = (attempts: number) => Math.min(2 ** attempts, 16);

/**
 * Sends what is due. Safe to call concurrently: each row is claimed by a conditional update,
 * so two drains cannot send the same message twice.
 */
export async function drain(limit = 25): Promise<{ sent: number; failed: number }> {
  const now = new Date().toISOString();
  const due = db
    .prepare(
      `SELECT id, recipient, subject, body, attempts FROM notification_outbox
       WHERE status='pending' AND next_attempt_at <= ? ORDER BY created_at ASC LIMIT ?`,
    )
    .all(now, limit) as Row[];

  let sent = 0;
  let failed = 0;
  for (const row of due) {
    // Claim it: if another drain got here first, changes is 0 and we skip.
    const claimed = db
      .prepare("UPDATE notification_outbox SET attempts = attempts + 1 WHERE id=? AND status='pending' AND attempts=?")
      .run(row.id, row.attempts);
    if (!changed(claimed)) continue;

    try {
      await sendEmail({ to: row.recipient, subject: row.subject, text: row.body });
      db.prepare("UPDATE notification_outbox SET status='sent', sent_at=?, last_error='' WHERE id=?")
        .run(new Date().toISOString(), row.id);
      sent++;
    } catch (err) {
      const attempts = row.attempts + 1;
      const message = String(err instanceof Error ? err.message : err).slice(0, 300);
      if (attempts >= MAX_ATTEMPTS) {
        db.prepare("UPDATE notification_outbox SET status='failed', last_error=? WHERE id=?").run(message, row.id);
      } else {
        const next = new Date(Date.now() + backoffMinutes(attempts) * 60_000).toISOString();
        db.prepare("UPDATE notification_outbox SET last_error=?, next_attempt_at=? WHERE id=?").run(message, next, row.id);
      }
      failed++;
    }
  }
  return { sent, failed };
}

/**
 * Save and then try to send, without making the caller wait or fail. This is what application
 * code calls: the message is durable the moment this returns.
 */
export function notify(message: Message): void {
  const id = enqueue(message);
  if (!id) return;
  void drain().catch(() => {
    // The message is saved. A later drain, or the staff queue, will deal with it.
  });
}

/* ------------------------------------------------------------ staff queue */

export type OutboxRow = {
  id: string; recipient: string; subject: string; kind: string; status: string;
  attempts: number; lastError: string; createdAt: string; nextAttemptAt: string;
};

export function listProblems(): OutboxRow[] {
  const rows = db
    .prepare(
      `SELECT id, recipient, subject, kind, status, attempts, last_error, created_at, next_attempt_at
       FROM notification_outbox
       WHERE status='failed' OR (status='pending' AND attempts > 0)
       ORDER BY created_at DESC LIMIT 100`,
    )
    .all() as Record<string, string | number>[];
  return rows.map((r) => ({
    id: String(r.id), recipient: String(r.recipient), subject: String(r.subject), kind: String(r.kind),
    status: String(r.status), attempts: Number(r.attempts), lastError: String(r.last_error),
    createdAt: String(r.created_at), nextAttemptAt: String(r.next_attempt_at),
  }));
}

export function counts(): { pending: number; failed: number; sent: number } {
  const rows = db.prepare("SELECT status, COUNT(*) AS n FROM notification_outbox GROUP BY status").all() as { status: string; n: number }[];
  const by = Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
  return { pending: by.pending ?? 0, failed: by.failed ?? 0, sent: by.sent ?? 0 };
}

/** Staff pushing a failed message back into the queue for another try. */
export function retry(id: string): boolean {
  const res = db
    .prepare("UPDATE notification_outbox SET status='pending', attempts=0, next_attempt_at=?, last_error='' WHERE id=? AND status='failed'")
    .run(new Date().toISOString(), id);
  return changed(res) > 0;
}
