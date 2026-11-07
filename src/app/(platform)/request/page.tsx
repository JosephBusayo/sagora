import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { DISTRICTS, SERVICES, getApprovedBusiness } from "@/lib/business";
import { BookForm } from "@/components/requests/BookForm";
import { GuestShell } from "@/components/guest/GuestShell";
import { redirect } from "next/navigation";
import { signedInFarmer } from "@/lib/session";

export const metadata: Metadata = { title: "Request a service" };
export const dynamic = "force-dynamic";

/** A request without an account. The farmer gets a tracking code to come back with. */
export default async function Page({ searchParams }: { searchParams: Promise<{ service?: string; provider?: string }> }) {
  const { service: asked = "", provider } = await searchParams;
  const service = SERVICES.some((s) => s.id === asked) ? asked : "";
  // A farmer with an account books from their own home, where the request is kept with the others.
  if (await signedInFarmer()) redirect(service ? `/farmer/book?service=${service}` : "/farmer/book");
  const chosen = provider ? await getApprovedBusiness(provider) : null;
  const direct = chosen ? { id: chosen.id, name: chosen.name } : undefined;
  return (
    <GuestShell>
      <div className="modal modal--book guest__panel">
        <BookForm services={SERVICES} districts={DISTRICTS} service={service} direct={direct} submissionKey={randomUUID()} guest cancelHref="/" />
      </div>
      <p className="guest__note">
        Already sent a request? <Link href="/request/find">Find it here</Link>
      </p>
    </GuestShell>
  );
}
