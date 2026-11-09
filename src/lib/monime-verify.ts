import "server-only";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { db } from "./db";
import { sendSms, smsConfigured } from "./sms";

/**
 * WAITING-ON #2 (7 Nov): the design's "Monime — Verify account" screen sends a code to the
 * Monime phone number before Sagora saves it as a payout destination. Sagora has no SMS sender
 * yet, so this stays inert — {@link requiresVerification} is false — until SMS_PROVIDER_URL and
 * SMS_PROVIDER_API_KEY are set (see lib/sms.ts). The moment they are, saving a Monime payout
 * destination asks for this code first; nothing else about the feature needs to change.
 */

const CODE_LENGTH = 6;
const CODE_MINUTES = 10;
const MAX_ATTEMPTS = 5;
const RESEND_SECONDS = 30;

export const requiresVerification = (method: string): boolean => method === "mobile_money" && smsConfigured();

const hash = (code: string) => createHash("sha256").update(code).digest("hex");
const iso = (d: Date) => d.toISOString();
const plus = (ms: number) => new Date(Date.now() + ms);

type Row = { business_id: string; phone: string; code_hash: string; attempts: number; expires_at: string; last_sent_at: string };

/** Sends a fresh code to this phone number. Reuses a code sent in the last half minute. */
export async function sendVerificationCode(businessId: string, phone: string): Promise<void> {
  const code = String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
  const claimed = await db.run(`INSERT INTO monime_phone_verification (business_id, phone, code_hash, attempts, expires_at, last_sent_at)
     VALUES (?,?,?,0,?,?)
     ON CONFLICT(business_id) DO UPDATE SET
       phone=excluded.phone, code_hash=excluded.code_hash, attempts=0,
       expires_at=excluded.expires_at, last_sent_at=excluded.last_sent_at
     WHERE monime_phone_verification.last_sent_at < ? OR monime_phone_verification.phone <> excluded.phone`,
    businessId, phone, hash(code), iso(plus(CODE_MINUTES * 60_000)), iso(new Date()), iso(plus(-RESEND_SECONDS * 1000)));
  if (!claimed.changes) return; // a code for the same number went out moments ago; let that one be used

  await sendSms({ to: phone, body: `Your Sagora Monime verification code is ${code}. It expires in ${CODE_MINUTES} minutes.` });
}

export type CheckResult = { ok: true } | { ok: false; reason: string };

/** Checks a code against the pending request for this business and phone number. */
export async function checkVerificationCode(businessId: string, phone: string, submitted: string): Promise<CheckResult> {
  const r = (await db.get("SELECT * FROM monime_phone_verification WHERE business_id=?", businessId)) as Row | undefined;
  if (!r || r.phone !== phone) return { ok: false, reason: "Ask for a new code for this number." };
  if (r.expires_at <= iso(new Date())) return { ok: false, reason: "That code has expired. Ask for a new one." };
  if (r.attempts >= MAX_ATTEMPTS) return { ok: false, reason: "Too many wrong codes. Ask for a new one." };

  const a = Buffer.from(hash(submitted.trim()));
  const b = Buffer.from(r.code_hash);
  const match = a.length === b.length && timingSafeEqual(a, b);
  if (!match) {
    await db.run("UPDATE monime_phone_verification SET attempts = attempts + 1 WHERE business_id=?", businessId);
    const left = MAX_ATTEMPTS - (r.attempts + 1);
    return { ok: false, reason: left > 0 ? "That code is not right." : "Too many wrong codes. Ask for a new one." };
  }

  // Spent the moment it works, so it cannot be replayed for a later change.
  await db.run("DELETE FROM monime_phone_verification WHERE business_id=?", businessId);
  return { ok: true };
}
