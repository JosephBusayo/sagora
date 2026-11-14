import "server-only";

/**
 * The Monime API, as far as Sagora uses it: open a hosted checkout, read it back, and register
 * where Monime sends its notices. https://docs.monime.io
 *
 * Settings, all server-side (Vercel and .env.local, never the browser):
 *  - MONIME_ACCESS_TOKEN   `mon_test_…` in test mode, `mon_…` live
 *  - MONIME_SPACE_ID       `spc-…`
 *  - MONIME_WEBHOOK_SECRET a long random string Monime sends back with every notice
 *  - MONIME_TESTERS        while the token is a test one on the live site: the farmer emails,
 *                          comma-separated, who see "Pay now". Everyone else sees nothing new.
 *  - MONIME_API_URL        only for the automated tests, which talk to a stand-in Monime.
 */

const base = () => (process.env.MONIME_API_URL?.trim() || "https://api.monime.io").replace(/\/+$/, "");
const token = () => process.env.MONIME_ACCESS_TOKEN?.trim() ?? "";
const space = () => process.env.MONIME_SPACE_ID?.trim() ?? "";

export const monimeConfigured = () => Boolean(token() && space());
/** Test tokens move simulated money only. */
export const monimeTestMode = () => token().startsWith("mon_test_");

/**
 * Whether this farmer is offered online payment.
 *
 * With a live token, everyone. With a test token, nobody: Monime refuses to open a checkout at
 * all for one — "Test mode is not supported for this endpoint: '/v1/checkout-sessions'" — so the
 * button could only ever fail. Paying by transfer and having Sagora record it still works, which
 * is the path the whole system is built around anyway.
 *
 * The exception is the automated tests, which talk to a stand-in Monime that does support it.
 * MONIME_TESTERS then names who sees the button, as it did before.
 */
export function monimeOfferedTo(email: string): boolean {
  if (!monimeConfigured()) return false;
  if (!monimeTestMode()) return true;
  if (!process.env.MONIME_API_URL?.trim()) return false;
  if (process.env.SAGORA_ENV !== "production") return true;
  const testers = (process.env.MONIME_TESTERS ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  return testers.includes(email.toLowerCase());
}

export class MonimeError extends Error {
  constructor(public status: number, message: string) {
    super(`Monime ${status}: ${message}`);
  }
}

async function call<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token()}`,
    "Monime-Space-Id": space(),
    "Monime-Version": "caph.2025-08-23",
    Accept: "application/json",
  };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`${base()}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), cache: "no-store" });
  const text = await res.text();
  let json: { result?: T; error?: { message?: string }; messages?: unknown[] } = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    // Not JSON: reported below with the status.
  }
  if (!res.ok) throw new MonimeError(res.status, json.error?.message ?? text.slice(0, 200));
  return json.result as T;
}

export type CheckoutSession = {
  id: string;
  status: "pending" | "completed" | "cancelled" | "expired";
  redirectUrl?: string | null;
  orderNumber?: string | null;
  reference?: string | null;
  metadata?: Record<string, string> | null;
};

export function createCheckoutSession(input: {
  key: string; name: string; reference: string; itemName: string; amountMinor: number;
  successUrl: string; cancelUrl: string; metadata: Record<string, string>;
}): Promise<CheckoutSession> {
  return call<CheckoutSession>("POST", "/v1/checkout-sessions", {
    name: input.name,
    reference: input.reference,
    successUrl: input.successUrl,
    cancelUrl: input.cancelUrl,
    lineItems: [{ type: "custom", name: input.itemName, price: { currency: "SLE", value: input.amountMinor }, quantity: 1 }],
    metadata: input.metadata,
  }, input.key);
}

export const getCheckoutSession = (id: string) => call<CheckoutSession>("GET", `/v1/checkout-sessions/${encodeURIComponent(id)}`);

type Webhook = { id: string; url: string; events: string[]; enabled: boolean };

/** The events Sagora listens for. */
export const WEBHOOK_EVENTS = ["checkout_session.completed", "checkout_session.cancelled", "checkout_session.expired"];

/**
 * Points Monime's notices at this site. Run again safely: an existing registration for the same
 * address is updated rather than doubled.
 */
export async function registerWebhook(url: string, secret: string): Promise<"created" | "updated"> {
  const existing = (await call<Webhook[]>("GET", "/v1/webhooks")) ?? [];
  const body = {
    name: "Sagora payments",
    url,
    apiRelease: "caph",
    events: WEBHOOK_EVENTS,
    enabled: true,
    headers: { "x-sagora-webhook-secret": secret },
    verificationMethod: { type: "HS256", secret },
  };
  const same = existing.find((w) => w.url === url);
  if (same) {
    await call("PATCH", `/v1/webhooks/${encodeURIComponent(same.id)}`, body);
    return "updated";
  }
  await call("POST", "/v1/webhooks", body, `sagora-webhook-${url}`.slice(0, 64));
  return "created";
}
