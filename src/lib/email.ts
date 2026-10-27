import "server-only";
import fs from "node:fs";
import path from "node:path";

export type Email = { to: string; subject: string; text: string };

/**
 * Single seam for outgoing email. Swap the provider here without touching callers.
 *
 * - With RESEND_API_KEY set: sends through Resend (free tier is enough to start).
 * - In development with no key: appends the message to data/dev-outbox.jsonl so
 *   you (and the browser tests) can read verification codes. In production this is
 *   refused, except when SAGORA_TEST_OUTBOX=1 is set (used only by the browser tests).
 *
 * TODO (stage 2): save an outbox row first, then send with retries and duplicate
 * protection, as the brief requires, so a provider outage never loses an event.
 */
export async function sendEmail(email: Email): Promise<void> {
  const key = process.env.RESEND_API_KEY;
  if (key) {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        from: process.env.EMAIL_FROM ?? "Sagora <onboarding@resend.dev>",
        to: [email.to],
        subject: email.subject,
        text: email.text,
      }),
    });
    if (!res.ok) throw new Error(`Email provider rejected the message (${res.status})`);
    return;
  }

  if (process.env.NODE_ENV === "production" && process.env.SAGORA_TEST_OUTBOX !== "1") {
    throw new Error("No email provider configured (set RESEND_API_KEY).");
  }

  const file = path.join(process.cwd(), "data", "dev-outbox.jsonl");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify({ ...email, at: new Date().toISOString() }) + "\n");
  console.info(`[dev email] to=${email.to} subject="${email.subject}" (see data/dev-outbox.jsonl)`);
}
