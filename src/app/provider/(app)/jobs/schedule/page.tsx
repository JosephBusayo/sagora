import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace } from "@/lib/guard";
import { listAssets } from "@/lib/equipment";
import { listJobs } from "@/lib/jobs";
import { Shell, PageHead } from "@/components/app/Shell";

export const metadata: Metadata = { title: "Schedule" };
export const dynamic = "force-dynamic";

const DAYS = 14;
const HOLDING = ["scheduled", "in_progress", "work_reported"];

/** Which machine is on which job, day by day. No Figma frame exists: the brief asks for a schedule. */
export default async function Page() {
  const { user, business } = await requireWorkspace();
  const assets = (await listAssets(business.id)).filter((a) => a.status === "active");
  const jobs = (await listJobs(business.id)).filter((j) => HOLDING.includes(j.status) && j.startDate && j.endDate);

  const today = Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), new Date().getUTCDate());
  const days = Array.from({ length: DAYS }, (_, i) => new Date(today + i * 86400000).toISOString().slice(0, 10));
  const label = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "UTC" });

  return (
    <Shell crumb={{ label: "Jobs", icon: "jobs" }} user={{ name: user.name }}>
      <PageHead title="Schedule" subtitle="Your machines over the next two weeks" />
      <p className="jobs-links"><Link href="/provider/jobs">Back to jobs</Link></p>
      {assets.length === 0 ? <div className="table-card"><p className="empty">Add equipment to see its schedule.</p></div> : (
        <div className="table-card schedule">
          <table className="table">
            <thead>
              <tr>
                <th scope="col">Machine</th>
                {days.map((d) => <th key={d} scope="col">{label(d)}</th>)}
              </tr>
            </thead>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id}>
                  <th scope="row">{a.name}</th>
                  {days.map((d) => {
                    const job = jobs.find((j) => j.assetIds.includes(a.id) && j.startDate! <= d && d <= j.endDate!);
                    return <td key={d} className={job ? "schedule__busy" : undefined}>{job?.reference ?? ""}</td>;
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
