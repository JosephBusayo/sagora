import type { Metadata } from "next";
import { requireFarmer } from "@/lib/session";
import { Shell, PageHead } from "@/components/app/Shell";
import { HelpContent } from "@/components/app/HelpContent";
import { unreadCount } from "@/lib/notifications";

export const metadata: Metadata = { title: "Help & support" };

export default async function Page() {
  const farmer = await requireFarmer();
  return (
    <Shell crumb={{ label: "Help & support", icon: "help" }} user={{ name: farmer.name }} audience="farmer" unread={await unreadCount(farmer)}>
      <PageHead title="Help & support" subtitle="Answers to common questions" />
      <HelpContent audience="farmer" />
    </Shell>
  );
}
