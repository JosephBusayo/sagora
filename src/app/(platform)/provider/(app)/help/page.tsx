import type { Metadata } from "next";
import { requireWorkspace } from "@/lib/guard";
import { Shell, PageHead } from "@/components/app/Shell";
import { HelpContent } from "@/components/app/HelpContent";
import { unreadCount } from "@/lib/notifications";

export const metadata: Metadata = { title: "Help & support" };

export default async function Page() {
  const { user } = await requireWorkspace();
  return (
    <Shell crumb={{ label: "Help & support", icon: "help" }} user={{ name: user.name }} unread={await unreadCount(user)}>
      <PageHead title="Help & support" subtitle="Answers to common questions" />
      <HelpContent audience="provider" />
    </Shell>
  );
}
