import { requireStaff } from "@/lib/session";
import { districtLabel } from "@/lib/business";
import { serviceLabel } from "@/lib/requests";
import { searchForStaff } from "@/lib/staff-search";
import type { Suggestion } from "@/components/app/SearchBox";

/** What the staff search box offers while someone types: the same matches as the search page, fewer of them. */
export async function GET(req: Request) {
  await requireStaff();
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (!q) return Response.json([]);
  const { assisted, providers, payments } = await searchForStaff(q);
  const rows: Suggestion[] = [
    ...assisted.slice(0, 3).map((r): Suggestion => ({
      kind: "request", service: r.service, label: r.reference, sub: `${r.contactName} · ${serviceLabel(r.service)} · ${districtLabel(r.district)}`, href: `/staff/requests/${r.id}`,
    })),
    ...providers.slice(0, 3).map((b): Suggestion => ({ kind: "provider", label: b.name, sub: b.sub, href: "/staff/providers" })),
    ...payments.slice(0, 3).map((p): Suggestion => ({ kind: "request", label: p.reference, sub: `Payments · ${p.businessName}`, href: "/staff/payments" })),
  ];
  return Response.json(rows.slice(0, 6));
}
