import http from "node:http";

/**
 * A stand-in for Monime's API and hosted checkout page, so online payment is tested end to end
 * without the network or real money. It answers only what Sagora calls, in Monime's shapes.
 */
export const STUB_PORT = 3499;

type Session = {
  id: string; status: "pending" | "completed" | "cancelled" | "expired"; redirectUrl: string; orderNumber: string;
  successUrl: string; cancelUrl: string; amount: number; reference: string;
};
export type Seen = { method: string; path: string; headers: http.IncomingHttpHeaders; body: unknown };

export function startMonimeStub() {
  const sessions = new Map<string, Session>();
  const seen: Seen[] = [];
  let n = 0;
  const send = (res: http.ServerResponse, status: number, body: unknown) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(body));
  };
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", `http://localhost:${STUB_PORT}`);
      const body = raw ? JSON.parse(raw) : undefined;
      seen.push({ method: req.method ?? "", path: url.pathname, headers: req.headers, body });

      if (url.pathname.startsWith("/v1/")) {
        if (!String(req.headers.authorization).startsWith("Bearer mon_test_") || !req.headers["monime-space-id"]) {
          return send(res, 401, { error: { message: "unauthorised" } });
        }
      }
      if (req.method === "POST" && url.pathname === "/v1/checkout-sessions") {
        const id = `scs-${++n}`;
        const s: Session = {
          id, status: "pending", redirectUrl: `http://localhost:${STUB_PORT}/pay/${id}`, orderNumber: `ORD-${n}`,
          successUrl: body.successUrl, cancelUrl: body.cancelUrl, amount: body.lineItems[0].price.value, reference: body.reference,
        };
        sessions.set(id, s);
        return send(res, 200, { success: true, result: s });
      }
      const get = url.pathname.match(/^\/v1\/checkout-sessions\/([^/]+)$/);
      if (req.method === "GET" && get) {
        const s = sessions.get(get[1]);
        return s ? send(res, 200, { success: true, result: s }) : send(res, 404, { error: { message: "not found" } });
      }
      // The hosted page: one button to pay, one to cancel.
      const page = url.pathname.match(/^\/pay\/([^/]+)(\/(complete|cancel|mark-paid))?$/);
      if (page) {
        const s = sessions.get(page[1]);
        if (!s) return send(res, 404, {});
        if (page[3] === "complete") { s.status = "completed"; res.writeHead(302, { Location: s.successUrl }); return res.end(); }
        if (page[3] === "cancel") { s.status = "cancelled"; res.writeHead(302, { Location: s.cancelUrl }); return res.end(); }
        if (page[3] === "mark-paid") { s.status = "completed"; return send(res, 200, { ok: true }); }
        res.writeHead(200, { "Content-Type": "text/html" });
        return res.end(`<!doctype html><title>Monime checkout</title><h1>Pay SLE ${s.amount / 100}</h1>
          <a href="/pay/${s.id}/complete">Pay with mobile money</a> <a href="/pay/${s.id}/cancel">Cancel</a>`);
      }
      send(res, 404, { error: { message: "no such route" } });
    });
  });
  return {
    sessions,
    seen,
    start: () => new Promise<void>((r) => server.listen(STUB_PORT, r)),
    stop: () => new Promise<void>((r) => server.close(() => r())),
  };
}
