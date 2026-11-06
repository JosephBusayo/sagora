import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { BusinessForm } from "@/components/app/forms";
import { siteUrl } from "@/lib/site";

export const metadata: Metadata = { title: "Business details" };

export default async function Page() {
  const { user, business } = await requireWorkspace();
  return (
    <Shell crumb={{ label: "Settings", icon: "settings" }} user={{ name: user.name }}>
      <PageHead title="Business details" subtitle="Update your business information. This information is used to match you with requests." />
      <BusinessForm
        initial={{ name: business.name, phone: business.phone.replace(/^\+232/, ""), email: business.email, town: business.town, description: business.description }}
      />
      <section className="panel">
        <h2 className="quotes__heading">Your direct link</h2>
        <p className="field__helper">Share this with your customers. Their request comes only to you.</p>
        <p className="staff-link">{siteUrl()}/p/{business.id}</p>
      </section>
    </Shell>
  );
}
