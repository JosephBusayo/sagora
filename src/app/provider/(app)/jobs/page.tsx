import { FilterPill } from "@/components/app/FilterPill";
import { FilterAutoSubmit } from "@/components/requests/FilterAutoSubmit";
import { SERVICES } from "@/lib/business";
import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { Pager, pageOf } from "@/components/app/Pager";
import { districtLabel } from "@/lib/business";
import { serviceLabel } from "@/lib/requests";
import { getAsset, selectableAssets } from "@/lib/equipment";
import { listMembers } from "@/lib/team";
import { JOB_STATUS_LABEL, atRiskAssets, listJobs, machineChanges, type JobStatus } from "@/lib/jobs";
import { JobsList, type JobView } from "@/components/jobs/JobsList";

export const metadata: Metadata = { title: "Jobs" };
export const dynamic = "force-dynamic";

type Filters = { page?: string; service?: string; district?: string; status?: string };

const fmt = (iso: string | null) =>
  iso ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : null;

export default async function Page({ searchParams }: { searchParams: Promise<Filters> }) {
  const { user, business, permission } = await requireWorkspace();
  const sp = await searchParams;
  const all = await listJobs(business.id);
  const districts = [...new Set(all.map((j) => j.district))].sort();
  const paged = pageOf(all.filter((j) =>
    (!sp.service || j.service === sp.service) && (!sp.district || j.district === sp.district) && (!sp.status || j.status === sp.status),
  ), sp.page);
  const members = await listMembers(business.id);
  const available = await selectableAssets(business.id);

  const jobs: JobView[] = await Promise.all(
    paged.rows.map(async (j) => {
    const names = await Promise.all(
      j.assetIds.map(async (id) => (await getAsset(business.id, id))?.name ?? "A machine"),
    );
    return {
      id: j.id,
      reference: j.reference,
      service: j.service,
      serviceLabel: serviceLabel(j.service),
      district: districtLabel(j.district),
      village: j.village,
      acres: j.acres,
      status: j.status,
      statusLabel: JOB_STATUS_LABEL[j.status as JobStatus],
      startDate: fmt(j.startDate),
      endDate: fmt(j.endDate),
      assetNames: names,
      operatorName: members.find((m) => m.id === j.operatorId)?.name ?? null,
      atRisk: await atRiskAssets(business.id, j),
      privateCustomer: j.privateCustomer,
      changes: (await machineChanges(j.id)).map((c) => `${fmt(c.at.slice(0, 10))}: ${c.detail}`),
      reportedAcres: j.reportedAcres,
      workNote: j.workNote,
      concern: j.concern,
      schedule: {
        startDate: j.startDate ?? "",
        endDate: j.endDate ?? "",
        operatorId: j.operatorId ?? "",
        assetIds: j.assetIds,
      },
    };
    }),
  );

  // Machines already on this job stay choosable even if a fault appeared, so the plan is visible.
  const onJobs = new Set(jobs.flatMap((j) => j.schedule.assetIds));
  const assetOptions = [
    ...available.map((a) => ({ id: a.id, label: a.name })),
    ...(await Promise.all(
      [...onJobs]
        .filter((id) => !available.some((a) => a.id === id))
        .map(async (id) => ({ id, label: `${(await getAsset(business.id, id))?.name ?? "A machine"} (unavailable)` })),
    )),
  ];

  return (
    <Shell crumb={{ label: "Jobs", icon: "jobs" }} user={{ name: user.name }}>
      <PageHead
        title="My Jobs"
        subtitle="View and manage the jobs you have been assigned"
        action={
          <div className="head-actions">
            <p className="jobs-links">
              <Link href="/provider/jobs/schedule">Schedule</Link>
              {permission !== "view_jobs" ? <Link href="/provider/jobs/new">Add a private job</Link> : null}
            </p>
            <form className="filters" method="get">
              <FilterPill name="service" label="Service" value={sp.service} icon="/icons/service.svg"
                options={[{ value: "", label: "All services" }, ...SERVICES.map((s) => ({ value: s.id, label: s.label }))]} />
              <FilterPill name="district" label="District" value={sp.district} icon="/icons/pin.svg"
                options={[{ value: "", label: "All districts" }, ...districts.map((d) => ({ value: d, label: districtLabel(d) }))]} />
              <FilterPill name="status" label="Status" value={sp.status} icon="/icons/status.svg"
                options={[{ value: "", label: "Status" }, ...Object.entries(JOB_STATUS_LABEL).map(([value, label]) => ({ value, label }))]} />
              <noscript><button type="submit" className="button button--inline">Apply</button></noscript>
              <FilterAutoSubmit />
            </form>
          </div>
        }
      />
      <JobsList
        jobs={jobs}
        assets={assetOptions}
        operators={members.map((m) => ({ id: m.id, label: m.name }))}
        canEdit={permission !== "view_jobs"}
      />
      <Pager page={paged.page} pages={paged.pages} path="/provider/jobs" />
    </Shell>
  );
}
