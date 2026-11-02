import { requireWorkspace } from "@/lib/guard";
import { searchForProvider, serviceLabel } from "@/lib/requests";
import { listJobs } from "@/lib/jobs";
import { kindLabel, listAssets } from "@/lib/equipment";
import { districtLabel } from "@/lib/business";
import type { Suggestion } from "@/components/app/SearchBox";

/** What the search box offers while someone types: the same matches as the search page, fewer of them. */
export async function GET(req: Request) {
  const { business } = await requireWorkspace();
  const q = (new URL(req.url).searchParams.get("q") ?? "").trim().slice(0, 80);
  if (!q) return Response.json([]);
  const term = q.toLowerCase();
  const has = (...values: string[]) => values.some((v) => v.toLowerCase().includes(term));

  const requests = (await searchForProvider(q, business)).slice(0, 3).map((r): Suggestion => ({
    kind: "request", service: r.service, label: r.reference, sub: `${serviceLabel(r.service)} · ${districtLabel(r.district)}`, href: `/provider/requests?open=${r.reference}`,
  }));
  const jobs = (await listJobs(business.id)).filter((j) => has(j.reference, j.village, j.district)).slice(0, 3).map((j): Suggestion => ({
    kind: "job", service: j.service, label: j.reference, sub: `Job · ${j.village}, ${districtLabel(j.district)}`, href: `/provider/jobs?open=${j.reference}`,
  }));
  const assets = (await listAssets(business.id)).filter((a) => has(a.name, a.identifier, kindLabel(a.kind))).slice(0, 3).map((a): Suggestion => ({
    kind: "equipment", label: a.name, sub: kindLabel(a.kind), href: "/provider/equipment",
  }));
  return Response.json([...assets, ...requests, ...jobs].slice(0, 6));
}
