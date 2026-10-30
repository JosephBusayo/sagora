import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { districtLabel } from "@/lib/business";
import { serviceLabel } from "@/lib/requests";
import { getAsset, selectableAssets } from "@/lib/equipment";
import { listMembers } from "@/lib/team";
import { JOB_STATUS_LABEL, atRiskAssets, listJobs, type JobStatus } from "@/lib/jobs";
import { JobsList, type JobView } from "@/components/jobs/JobsList";

export const metadata: Metadata = { title: "Jobs" };
export const dynamic = "force-dynamic";

const fmt = (iso: string | null) =>
  iso ? new Date(iso + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : null;

export default async function Page() {
  const { user, business, permission } = await requireWorkspace();
  const members = await listMembers(business.id);
  const available = await selectableAssets(business.id);

  const jobs: JobView[] = await Promise.all(
    (await listJobs(business.id)).map(async (j) => {
    const names = await Promise.all(
      j.assetIds.map(async (id) => (await getAsset(business.id, id))?.name ?? "A machine"),
    );
    return {
      id: j.id,
      reference: j.reference,
      service: j.service,
      serviceLabel: serviceLabel(j.service),
      where: `${j.village}, ${districtLabel(j.district)}`,
      acres: j.acres,
      status: j.status,
      statusLabel: JOB_STATUS_LABEL[j.status as JobStatus],
      startDate: fmt(j.startDate),
      endDate: fmt(j.endDate),
      assetNames: names,
      operatorName: members.find((m) => m.id === j.operatorId)?.name ?? null,
      atRisk: await atRiskAssets(business.id, j),
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
      />
      <JobsList
        jobs={jobs}
        assets={assetOptions}
        operators={members.map((m) => ({ id: m.id, label: m.name }))}
        canEdit={permission !== "view_jobs"}
      />
    </Shell>
  );
}
