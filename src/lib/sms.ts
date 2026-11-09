import "server-only";
import fs from "node:fs";
import path from "node:path";

export type Sms = { to: string; body: string };

/**
 * Single seam for outgoing SMS, in the shape of lib/email.ts: one function, one place that
 * knows which provider is behind it.
 *
 * Nothing in Sagora sends an SMS yet — the brief dropped SMS/OTP for the farmer-facing product
 * (§2) — but the design's "Monime — Verify account" screen (WAITING-ON #2, 7 Nov) asks for one
 * SMS: a code to the Monime phone number before Sagora saves it as a payout destination. Rather
 * than build that one call with no seam at all, it is wired the same way email already is, so
 * whichever SMS gateway Karim picks is one adapter, not a rewrite of lib/monime-verify.ts.
 *
 * `SMS_PROVIDER_URL` and `SMS_PROVIDER_API_KEY` are deliberately generic: Sagora has no SMS
 * provider account yet, and Sierra Leone-capable gateways differ in their exact request shape.
 * This POSTs `{ to, body }` with a bearer token, which covers a generic webhook-style gateway;
 * if the real provider needs a different body, that is a change to this one file.
 */
export const smsConfigured = (): boolean => Boolean(process.env.SMS_PROVIDER_URL?.trim() && process.env.SMS_PROVIDER_API_KEY?.trim());

export async function sendSms(message: Sms): Promise<void> {
  const url = process.env.SMS_PROVIDER_URL?.trim();
  const key = process.env.SMS_PROVIDER_API_KEY?.trim();

  if (url && key) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: message.to, body: message.body }),
    });
    if (!res.ok) throw new Error(`SMS provider rejected the message (${res.status}): ${(await res.text()).slice(0, 200)}`);
    return;
  }

  if (process.env.NODE_ENV === "production" && process.env.SAGORA_TEST_OUTBOX !== "1") {
    throw new Error("No SMS provider configured (set SMS_PROVIDER_URL and SMS_PROVIDER_API_KEY).");
  }

  // Development / tests: same pattern as data/dev-outbox.jsonl, so a code can be read without
  // a real phone.
  const file = path.join(process.cwd(), "data", "dev-sms-outbox.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ ...message, at: new Date().toISOString() }) + "\n");
  console.info(`[dev sms] to=${message.to} (see data/dev-sms-outbox.jsonl)`);
}
