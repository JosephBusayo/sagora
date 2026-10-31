import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace } from "@/lib/guard";
import { districtLabel } from "@/lib/business";
import { STATUS_LABEL, searchForProvider, serviceLabel } from "@/lib/requests";
import { JOB_STATUS_LABEL, listJobs, type JobStatus } from "@/lib/jobs";
import { kindLabel, listAssets } from "@/lib/equipment";
import { Shell, PageHead } from "@/components/app/Shell";

export const metadata: Metadata = { title: "Search" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const { user, business } = await requireWorkspace();
  const q = ((await searchParams).q ?? "").trim().slice(0, 80);
  const term = q.toLowerCase();
  const has = (...values: string[]) => values.some((v) => v.toLowerCase().includes(term));

  const requests = q ? await searchForProvider(q, business) : [];
  // Jobs and machines are this business's own: both lists are already scoped to it.
  const jobs = q ? (await listJobs(business.id)).filter((j) => has(j.reference, j.village, j.district)) : [];
  const assets = q ? (await listAssets(business.id)).filter((a) => has(a.name, a.identifier, kindLabel(a.kind))) : [];
  const nothing = requests.length + jobs.length + assets.length === 0;

  return (
    <Shell crumb={{ label: "Search", icon: "search" }} user={{ name: user.name || business.name }} audience="provider" search={q}>
      <PageHead title="Search" subtitle={q ? `Results for “${q}”` : "Search requests, jobs, equipments..."} />
      {nothing ? <p className="empty">{q ? "Nothing matches that search." : "Type a reference, place or machine."}</p> : null}
      {requests.length > 0 ? (
        <>
          <h2 className="quotes__heading">Requests</h2>
          <ul className="search-results">
            {requests.map((r) => (
              <li key={r.id}>
                <Link href={`/provider/requests?open=${r.reference}`}>{r.reference}</Link>
                <span>{serviceLabel(r.service)} · {r.village}, {districtLabel(r.district)}</span>
                <span className={`pill pill--${r.status}`}>{STATUS_LABEL[r.status]}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {jobs.length > 0 ? (
        <>
          <h2 className="quotes__heading">Jobs</h2>
          <ul className="search-results">
            {jobs.map((j) => (
              <li key={j.id}>
                <Link href="/provider/jobs">{j.reference}</Link>
                <span>{j.village}, {districtLabel(j.district)}</span>
                <span>{JOB_STATUS_LABEL[j.status as JobStatus]}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {assets.length > 0 ? (
        <>
          <h2 className="quotes__heading">Equipment</h2>
          <ul className="search-results">
            {assets.map((a) => (
              <li key={a.id}>
                <Link href="/provider/equipment">{a.name}</Link>
                <span>{kindLabel(a.kind)}{a.identifier ? ` · ${a.identifier}` : ""}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Shell>
  );
}
