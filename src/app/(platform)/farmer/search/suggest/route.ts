import { requireFarmer } from "@/lib/session";
import { searchForFarmer, serviceLabel } from "@/lib/requests";
import { districtLabel } from "@/lib/business";
import type { Suggestion } from "@/components/app/SearchBox";

/** What the search box offers while a farmer types: their own requests only. */
export async function GET(req: Request) {
  const farmer = await requireFarmer();
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (!q) return Response.json([]);
  const rows = (await searchForFarmer(farmer.id, q)).slice(0, 6);
  return Response.json(rows.map((r): Suggestion => ({
    kind: "request", service: r.service, label: r.reference, sub: `${serviceLabel(r.service)} · ${r.village}, ${districtLabel(r.district)}`, href: `/farmer/requests/${r.id}`,
  })));
}
