import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { AccountForm } from "@/components/app/forms";

export const metadata: Metadata = { title: "Account" };

export default async function Page() {
  const { user } = await requireWorkspace();
  return (
    <Shell crumb={{ label: "Settings", icon: "settings" }} user={{ name: user.name }}>
      <PageHead title="Account" subtitle="Manage your personal account details" />
      <AccountForm initial={{ name: user.name, phone: (user.phone ?? "").replace(/^\+232/, ""), email: user.email }} />
    </Shell>
  );
}
