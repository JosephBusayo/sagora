import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/guard";
import { DISTRICTS, SERVICES } from "@/lib/business";
import { Shell, PageHead } from "@/components/app/Shell";
import { PrivateJobForm } from "@/components/jobs/PrivateJobForm";

export const metadata: Metadata = { title: "Add a private job" };
export const dynamic = "force-dynamic";

/** No Figma frame exists for this: it is in the brief, and built in the design system's language. */
export default async function Page() {
  const { user, permission } = await requireWorkspace();
  if (permission === "view_jobs") redirect("/provider/jobs");
  return (
    <Shell crumb={{ label: "Jobs", icon: "jobs" }} user={{ name: user.name }}>
      <PageHead title="Add a private job" subtitle="Work from outside Sagora. It blocks your machines and no one else can see it." />
      <div className="panel"><PrivateJobForm services={SERVICES} districts={DISTRICTS} /></div>
    </Shell>
  );
}
