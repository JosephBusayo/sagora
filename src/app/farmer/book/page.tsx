import type { Metadata } from "next";
import { DISTRICTS, SERVICES } from "@/lib/business";
import { requireFarmer } from "@/lib/session";
import { Shell, PageHead } from "@/components/app/Shell";
import { BookForm } from "@/components/requests/BookForm";
import { unreadCount } from "@/lib/notifications";

export const metadata: Metadata = { title: "Book a service" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ service?: string }> }) {
  const farmer = await requireFarmer();
  const asked = (await searchParams).service ?? "";
  const service = SERVICES.some((s) => s.id === asked) ? asked : "";

  return (
    <Shell
      crumb={{ label: "Book a service", icon: "plus" }}
      user={{ name: farmer.name }}
      audience="farmer"
      unread={await unreadCount(farmer)}
    >
      <PageHead
        title="Book a service"
        subtitle="Tell us what you need. Providers in your district will send you quotes, and you choose."
      />
      <div className="panel panel--wide">
        <p className="book__rule">A request is not a booking. Nothing is confirmed until you accept a quote and pay.</p>
        <BookForm services={SERVICES} districts={DISTRICTS} service={service} />
      </div>
    </Shell>
  );
}
