import type { Metadata } from "next";
import { requireFarmer } from "@/lib/session";
import { Shell, PageHead } from "@/components/app/Shell";
import { FarmerPasswordForm } from "@/components/app/farmer-forms";
import { unreadCount } from "@/lib/notifications";

export const metadata: Metadata = { title: "Password" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const farmer = await requireFarmer();
  return (
    <Shell
      crumb={{ label: "Settings", icon: "settings" }}
      user={{ name: farmer.name }}
      audience="farmer"
      unread={unreadCount(farmer)}
    >
      <PageHead title="Password" subtitle="Changing your password signs you out everywhere else." />
      <FarmerPasswordForm />
    </Shell>
  );
}
