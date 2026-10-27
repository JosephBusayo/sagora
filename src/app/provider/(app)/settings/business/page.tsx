import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { BusinessForm } from "@/components/app/forms";

export const metadata: Metadata = { title: "Business details" };

export default async function Page() {
  const { user, business } = await requireWorkspace();
  return (
    <Shell crumb={{ label: "Settings", icon: "settings" }} user={{ name: user.name }}>
      <PageHead title="Business details" subtitle="Update your business information. This information is used to match you with requests." />
      <BusinessForm
        initial={{ name: business.name, phone: business.phone.replace(/^\+232/, ""), email: business.email, town: business.town, description: business.description }}
      />
    </Shell>
  );
}
