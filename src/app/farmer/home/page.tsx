import type { Metadata } from "next";
import { requireFarmer } from "@/lib/session";
import { Shell } from "@/components/app/Shell";
import { FarmerHome } from "@/components/app/FarmerHome";
import { listForFarmer } from "@/lib/requests";
import { unreadCount } from "@/lib/notifications";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const farmer = await requireFarmer();
  const requests = (await listForFarmer(farmer.id)).slice(0, 3);

  return (
    <Shell
      crumb={{ label: "Home", icon: "home" }}
      user={{ name: farmer.name }}
      audience="farmer"
      unread={await unreadCount(farmer)}
    >
      <FarmerHome name={farmer.name} requests={requests} />
    </Shell>
  );
}
