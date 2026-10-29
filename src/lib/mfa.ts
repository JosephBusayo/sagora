import "server-only";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { notify } from "./outbox";
import { OTP_LENGTH } from "./auth";

/**
 * A second factor for staff, by emailed code.
 *
 * The brief: *"MFA for staff and finance roles."* A password alone now stands between someone
 * and the screen that moves money, so signing in is not enough: a staff session must also pass
 * a code sent to the account's email before any staff screen opens.
 *
 * It is tied to the **session**, not the user, so a code proved in one browser does nothing for
 * another, and signing out ends it. It expires on its own after twelve hours, which means a
 * forgotten session on a shared machine stops being a way in overnight.
 */

const CODE_MINUTES = 10;
const WINDOW_HOURS = 12;
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 30;

const hash = (code: string) => createHash("sha256").update(code).digest("hex");
const now = () => new Date();
const iso = (d: Date) => d.toISOString();
const plus = (ms: number) => new Date(Date.now() + ms);

type Row = {
  session_id: string; user_id: string; code_hash: string | null; attempts: number;
  code_expires_at: string | null; last_sent_at: string | null; verified_until: string | null;
};

const rowFor = async (sessionId: string) =>
  (await db.get("SELECT * FROM staff_mfa WHERE session_id=?", sessionId)) as Row | undefined;

/** Has this session already proved a second factor, and is that still good? */
export async function isVerified(sessionId: string): Promise<boolean> {
  const r = await rowFor(sessionId);
  return Boolean(r?.verified_until && r.verified_until > iso(now()));
}

export type SendResult = { ok: true } | { ok: false; reason: string };

/**
 * Emails a fresh code for this session. Safe to call again: a code sent in the last half minute
 * is reused rather than replaced, so an impatient second click does not invalidate the code
 * already in the person's inbox.
 */
export async function sendCode(sessionId: string, user: { id: string; name: string; email: string }): Promise<SendResult> {
  const existing = await rowFor(sessionId);
  // A live code sent moments ago is reused, so an impatient second click does not invalidate
  // the one already in the inbox. A code that is spent, expired or burnt by wrong attempts is
  // replaced whatever the clock says — otherwise asking for a new one would do nothing.
  const stillUsable =
    existing?.code_hash &&
    existing.attempts < MAX_ATTEMPTS &&
    existing.code_expires_at &&
    existing.code_expires_at > iso(now());
  if (stillUsable && existing.last_sent_at && Date.now() - Date.parse(existing.last_sent_at) < RESEND_SECONDS * 1000) {
    return { ok: true };
  }

  // randomInt is the cryptographic generator; Math.random is not fit for a credential.
  const code = String(randomInt(0, 10 ** OTP_LENGTH)).padStart(OTP_LENGTH, "0");
  await db.run(`INSERT INTO staff_mfa (session_id, user_id, code_hash, attempts, code_expires_at, last_sent_at)
     VALUES (?,?,?,0,?,?)
     ON CONFLICT(session_id) DO UPDATE SET
       code_hash=excluded.code_hash, attempts=0,
       code_expires_at=excluded.code_expires_at, last_sent_at=excluded.last_sent_at`, sessionId, user.id, hash(code), iso(plus(CODE_MINUTES * 60_000)), iso(now()));

  await notify({
    kind: "staff.mfa",
    // Deliberately not deduped: every sign-in needs its own code.
    to: user.email,
    subject: "Your Sagora staff sign-in code",
    text:
      `${user.name}, your staff sign-in code is ${code}.\n\n` +
      `It expires in ${CODE_MINUTES} minutes and can only be used in the browser that asked for it.\n\n` +
      `If you did not try to sign in to Sagora staff, change your password now and tell the team: ` +
      `somebody else has your password.`,
  });
  return { ok: true };
}

export type CheckResult = { ok: true } | { ok: false; reason: string };

/** Checks a code. Wrong codes are counted; too many and the code is burned, not the account. */
export async function checkCode(sessionId: string, submitted: string): Promise<CheckResult> {
  const r = await rowFor(sessionId);
  if (!r || !r.code_hash || !r.code_expires_at) {
    return { ok: false, reason: "That code has expired. Ask for a new one." };
  }
  if (r.code_expires_at <= iso(now())) {
    return { ok: false, reason: "That code has expired. Ask for a new one." };
  }
  if (r.attempts >= MAX_ATTEMPTS) {
    return { ok: false, reason: "Too many wrong codes. Ask for a new one." };
  }

  const a = Buffer.from(hash(submitted.trim()));
  const b = Buffer.from(r.code_hash);
  const match = a.length === b.length && timingSafeEqual(a, b);
  if (!match) {
    await db.run("UPDATE staff_mfa SET attempts = attempts + 1 WHERE session_id=?", sessionId);
    const left = MAX_ATTEMPTS - (r.attempts + 1);
    return {
      ok: false,
      reason: left > 0 ? "That code is not right." : "Too many wrong codes. Ask for a new one.",
    };
  }

  // The code is spent the moment it works, so it cannot be replayed.
  const res = await db.run(`UPDATE staff_mfa SET code_hash=NULL, code_expires_at=NULL, attempts=0, verified_until=?
       WHERE session_id=?`, iso(plus(WINDOW_HOURS * 3_600_000)), sessionId);
  return res.changes > 0 ? { ok: true } : { ok: false, reason: "Something went wrong. Try again." };
}

/** Ends the second factor for this session — on sign-out, or when a password changes. */
export async function clearFor(sessionId: string) {
  await db.run("DELETE FROM staff_mfa WHERE session_id=?", sessionId);
}

/** Every session belonging to this user loses it: used when the password changes. */
export async function clearForUser(userId: string) {
  await db.run("DELETE FROM staff_mfa WHERE user_id=?", userId);
}
