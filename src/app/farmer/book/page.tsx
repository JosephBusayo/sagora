import type { Metadata } from "next";
import Link from "next/link";
import { DISTRICTS, SERVICES } from "@/lib/business";
import { requireFarmer } from "@/lib/session";
import { BookForm } from "@/components/requests/BookForm";

export const metadata: Metadata = { title: "Book a service" };

export default async function Page() {
  await requireFarmer();
  return (
    <main className="setup">
      <div className="setup__card book">
        <h1 className="auth__title">Book a service</h1>
        <p className="auth__subtitle">
          Tell us what you need. Providers in your district will send you quotes, and you choose.
        </p>
        <p className="book__rule">A request is not a booking. Nothing is confirmed until you accept a quote and pay.</p>
        <BookForm services={SERVICES} districts={DISTRICTS} />
        <p className="auth__footer"><Link href="/farmer/requests">See my requests</Link></p>
      </div>
    </main>
  );
}
