import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { requireFarmer } from "@/lib/session";
import { Shell } from "@/components/app/Shell";
import { FarmerHome } from "@/components/app/FarmerHome";
import { listForFarmer } from "@/lib/requests";
import { getApprovedBusiness } from "@/lib/business";
import { unreadCount } from "@/lib/notifications";

export const metadata: Metadata = { title: "Home" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const farmer = await requireFarmer();
  const requests = (await listForFarmer(farmer.id)).slice(0, 3);
  const directId = (await cookies()).get("sagora_direct")?.value;
  const direct = directId ? await getApprovedBusiness(directId) : null;

  return (
    <Shell
      crumb={{ label: "Home", icon: "home" }}
      user={{ name: farmer.name }}
      audience="farmer"
      unread={await unreadCount(farmer)}
    >
      {direct ? (
        <p className="notice notice--success" role="status">
          <Link href={`/farmer/book?provider=${direct.id}`}>Continue your request to {direct.name}</Link>
        </p>
      ) : null}
      <FarmerHome name={farmer.name} requests={requests} />
    </Shell>
  );
}
