import "server-only";
import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { db } from "./db";
import { audit } from "./business";
import { getById, guestActor, phoneKey, type ServiceRequest } from "./requests";

/**
 * Requests sent without an account (Karim, 7 Nov 2026). The farmer is shown a tracking code such
 * as SAG-8KM32 once, writes it down, and comes back with it and their phone number. The browser
 * that sent the request, or that came back with the code, is remembered for 30 days.
 */

// No 0/O, 1/I/L: a code is read off paper and typed on a phone.
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const COOKIE = "sagora_guest";
const NEW_CODE = "sagora_new_code";
const DAYS = 30;
const MISSES_PER_PHONE = 5;
const MISSES_PER_ADDRESS = 20;

const secret = () => process.env.BETTER_AUTH_SECRET || "sagora-local-secret";
const keyed = (s: string) => createHmac("sha256", secret()).update(s).digest("hex");
/** Keyed, so a copy of the database is no help in guessing codes. */
const codeHash = (code: string) => keyed(`tracking:${code}`);
const cookieOptions = (maxAge: number) => ({
  httpOnly: true, sameSite: "lax" as const, path: "/", maxAge, secure: Boolean(process.env.VERCEL),
});

/** "sag 8km32", "SAG-8KM32" and "8KM32" all read as SAG-8KM32. Anything else is not a code. */
export function normaliseCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = s.length === 8 && s.startsWith("SAG") ? s.slice(3) : s;
  return /^[A-Z0-9]{5}$/.test(body) ? `SAG-${body}` : null;
}

/** A fresh code for this request. It replaces any earlier one, which stops working at once. */
export async function issueTrackingCode(requestId: string, by: string): Promise<string> {
  for (let i = 0; i < 6; i++) {
    const code = `SAG-${Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("")}`;
    let changes = 0;
    try {
      changes = (await db.run("UPDATE service_request SET tracking_hash=? WHERE id=?", codeHash(code), requestId)).changes;
    } catch {
      continue; // Another request already has this code: draw again.
    }
    if (!changes) throw new Error("No such request");
    await audit(by, "request.tracking_code", requestId);
    return code;
  }
  throw new Error("Could not make a tracking code");
}

async function clientAddress(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for") ?? "").split(",")[0].trim() || h.get("x-real-ip") || "unknown";
}

export type Found = { ok: true; requestId: string } | { ok: false; error: string };

/** The code and the phone number must both match. Wrong tries are counted, so codes cannot be guessed. */
export async function findByCode(codeInput: string, phoneInput: string): Promise<Found> {
  const phone = phoneKey(phoneInput);
  const address = await clientAddress();
  const n = async (sql: string, ...args: unknown[]) => Number(((await db.get(sql, ...args)) as { n: number | string }).n);
  const quarterHour = new Date(Date.now() - 15 * 60_000).toISOString();
  const hour = new Date(Date.now() - 60 * 60_000).toISOString();
  if (await n("SELECT COUNT(*) AS n FROM guest_lookup_miss WHERE phone_key=? AND created_at>=?", phone, quarterHour) >= MISSES_PER_PHONE
    || await n("SELECT COUNT(*) AS n FROM guest_lookup_miss WHERE ip=? AND created_at>=?", address, hour) >= MISSES_PER_ADDRESS) {
    return { ok: false, error: "Too many wrong tries. Wait 15 minutes and try again, or speak to us on WhatsApp." };
  }
  const code = normaliseCode(codeInput);
  const row = code ? await db.get("SELECT id, contact_phone FROM service_request WHERE tracking_hash=?", codeHash(code)) as
    { id: string; contact_phone: string } | undefined : undefined;
  if (!row || phone.length < 8 || phoneKey(row.contact_phone) !== phone) {
    await db.run("INSERT INTO guest_lookup_miss (id, phone_key, ip, created_at) VALUES (?,?,?,?)", randomUUID(), phone, address, new Date().toISOString());
    return { ok: false, error: "We could not find a request with that tracking code and phone number. Check both and try again." };
  }
  await audit(guestActor(row.id), "request.found_by_code", row.id);
  return { ok: true, requestId: row.id };
}

const signature = (requestId: string, hash: string, expires: number) => keyed(`guest:${requestId}:${hash}:${expires}`);

async function currentHash(requestId: string): Promise<string | null> {
  const r = await db.get("SELECT tracking_hash FROM service_request WHERE id=?", requestId) as { tracking_hash: string | null } | undefined;
  return r?.tracking_hash ?? null;
}

/** This browser may open the request until the code is replaced or 30 days pass. */
export async function rememberGuest(requestId: string): Promise<void> {
  const hash = await currentHash(requestId);
  if (!hash) return;
  const expires = Date.now() + DAYS * 86_400_000;
  (await cookies()).set(COOKIE, `${requestId}.${expires}.${signature(requestId, hash, expires)}`, cookieOptions(DAYS * 86_400));
}

/** The request this browser was let into, if the code it came in with is still the current one. */
export async function guestRequestId(): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value ?? "";
  const [requestId, expiresText, sig] = raw.split(".");
  const expires = Number(expiresText);
  if (!requestId || !sig || !Number.isFinite(expires) || expires < Date.now()) return null;
  const hash = await currentHash(requestId);
  if (!hash) return null;
  const want = Buffer.from(signature(requestId, hash, expires));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? requestId : null;
}

export async function guestRequest(): Promise<ServiceRequest | null> {
  const id = await guestRequestId();
  return id ? getById(id) : null;
}

export async function forgetGuest(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
  jar.delete(NEW_CODE);
}

/** The code just made, kept for half an hour so a reload still shows it. Never put in a URL. */
export async function showCodeOnce(requestId: string, code: string): Promise<void> {
  (await cookies()).set(NEW_CODE, `${requestId}.${code}`, cookieOptions(30 * 60));
}

export async function newCodeFor(requestId: string): Promise<string | null> {
  const [id, code] = ((await cookies()).get(NEW_CODE)?.value ?? "").split(".");
  return id === requestId && code ? code : null;
}
