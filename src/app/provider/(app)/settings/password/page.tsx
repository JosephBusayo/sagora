import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { PasswordForm } from "@/components/app/forms";

export const metadata: Metadata = { title: "Password and security" };

export default async function Page() {
  const { user } = await requireWorkspace();
  return (
    <Shell crumb={{ label: "Settings", icon: "settings" }} user={{ name: user.name }}>
      <PageHead title="Password and security" subtitle="Changing your password signs you out everywhere else." />
      <PasswordForm />
    </Shell>
  );
}
