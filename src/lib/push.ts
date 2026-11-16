import "server-only";
import { createSign } from "node:crypto";
import { db } from "./db";
import { logError } from "./log";

/**
 * Notifications on a farmer's phone, through Firebase Cloud Messaging.
 *
 * This is the thing the app can do that the website cannot. Sagora tells people by email today,
 * and a farmer with a phone and no email address never hears that their quote arrived. Every
 * message already goes through one funnel (lib/outbox notify), so this hangs off that rather
 * than asking 29 call sites to remember.
 *
 * Settings, all server-side, from a Firebase service account:
 *  - FIREBASE_PROJECT_ID    the project, e.g. sagora-app
 *  - FIREBASE_CLIENT_EMAIL  …@….iam.gserviceaccount.com
 *  - FIREBASE_PRIVATE_KEY   the PEM, newlines written as \n
 *
 * Unset, nothing is sent and nothing breaks - the same as SMS and WhatsApp today.
 */

const projectId = () => process.env.FIREBASE_PROJECT_ID?.trim();
const clientEmail = () => process.env.FIREBASE_CLIENT_EMAIL?.trim();
// Written into an environment variable as one line, so the escaped newlines come back out.
const privateKey = () => process.env.FIREBASE_PRIVATE_KEY?.trim().replace(/\n/g, "\n");

export const pushConfigured = (): boolean => Boolean(projectId() && clientEmail() && privateKey());

export type Platform = "android" | "ios" | "web";

/** Remembers a phone. Called again on every launch, which is also how a device stays current. */
export async function registerDevice(userId: string, token: string, platform: Platform): Promise<void> {
  const now = new Date().toISOString();
  // A phone that changes hands must not keep the last person's notifications, so the token is
  // the key and the newest owner wins.
  await db.run(
    `INSERT INTO push_device (token, user_id, platform, created_at, last_seen_at) VALUES (?,?,?,?,?)
     ON CONFLICT (token) DO UPDATE SET user_id = excluded.user_id, platform = excluded.platform, last_seen_at = excluded.last_seen_at`,
    token, userId, platform, now, now,
  );
}

/** Signing out on a phone should stop that phone buzzing, so the device goes with the session. */
export async function forgetDevice(token: string): Promise<void> {
  await db.run("DELETE FROM push_device WHERE token=?", token);
}

/* ------------------------------------------------------------------ sending */

type Token = { access: string; until: number };
let cached: Token | null = null;

/** A Google access token for the messaging scope, from the service account. Good for an hour. */
async function accessToken(): Promise<string> {
  if (cached && cached.until > Date.now() + 60_000) return cached.access;
  const iat = Math.floor(Date.now() / 1000);
  const claim = {
    iss: clientEmail(),
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat,
    exp: iat + 3600,
  };
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const body = `${b64({ alg: "RS256", typ: "JWT" })}.${b64(claim)}`;
  const sig = createSign("RSA-SHA256").update(body).sign(privateKey()!, "base64url");

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${body}.${sig}` }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json()) as { access_token?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new Error(`Firebase token: ${json.error_description ?? res.status}`);
  cached = { access: json.access_token, until: Date.now() + 3_300_000 };
  return json.access_token;
}

export type PushMessage = { title: string; body: string; /** Where tapping it should open. */ url?: string };

/**
 * Tells every phone this person has. Never throws: a notification that cannot be delivered must
 * not take down the thing that caused it, and the email is on its way regardless.
 */
export async function pushToUser(userId: string, message: PushMessage): Promise<number> {
  if (!pushConfigured()) return 0;
  try {
    const rows = (await db.all("SELECT token FROM push_device WHERE user_id=?", userId)) as { token: string }[];
    if (rows.length === 0) return 0;
    const bearer = await accessToken();
    let sent = 0;
    for (const { token } of rows) {
      if (await deliver(bearer, token, message)) sent++;
    }
    return sent;
  } catch (err) {
    logError("push.send", err);
    return 0;
  }
}

/** One phone. A token Firebase says is dead is deleted rather than kept to fail again. */
async function deliver(bearer: string, token: string, message: PushMessage): Promise<boolean> {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId()}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: message.title, body: message.body },
        // Read by the app when the notification is tapped, to open the right screen.
        data: message.url ? { url: message.url } : undefined,
        android: { notification: { icon: "ic_stat_icon", color: "#024321" }, priority: "HIGH" },
      },
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (res.ok) return true;
  // 404 UNREGISTERED and 400 INVALID_ARGUMENT both mean this token will never work again.
  if (res.status === 404 || res.status === 400) {
    await db.run("DELETE FROM push_device WHERE token=?", token).catch(() => {});
    return false;
  }
  logError("push.send", new Error(`FCM ${res.status}`));
  return false;
}

/**
 * The same, found by email address, which is how the outbox addresses people. Someone with no
 * account - a guest who sent a request without signing up - simply has no phone registered.
 */
export async function pushToEmail(email: string, message: PushMessage): Promise<number> {
  if (!pushConfigured() || !email) return 0;
  try {
    const row = (await db.get(`SELECT id FROM "user" WHERE lower(email) = lower(?)`, email)) as { id: string } | undefined;
    return row ? await pushToUser(row.id, message) : 0;
  } catch (err) {
    logError("push.lookup", err);
    return 0;
  }
}
