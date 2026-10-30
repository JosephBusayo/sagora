import type { Metadata } from "next";
import { requireFarmer } from "@/lib/session";
import { Shell, PageHead } from "@/components/app/Shell";
import { FarmerAccountForm } from "@/components/app/farmer-forms";
import { unreadCount } from "@/lib/notifications";

export const metadata: Metadata = { title: "Account" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const farmer = await requireFarmer();
  return (
    <Shell
      crumb={{ label: "Settings", icon: "settings" }}
      user={{ name: farmer.name }}
      audience="farmer"
      unread={await unreadCount(farmer)}
    >
      <PageHead title="Account" subtitle="Manage your personal account details" />
      <FarmerAccountForm
        initial={{ name: farmer.name, phone: (farmer.phone ?? "").replace(/^\+232/, ""), email: farmer.email }}
      />
    </Shell>
  );
}
