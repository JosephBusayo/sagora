import type { Metadata } from "next";
import Link from "next/link";
import { AuthShell } from "@/components/auth/AuthShell";
import { WhatsAppButton } from "@/components/contact/WhatsAppButton";
import { FindRequestForm } from "@/components/guest/FindRequestForm";

export const metadata: Metadata = { title: "Find your request" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ left?: string }> }) {
  const { left } = await searchParams;
  return (
    <AuthShell
      image="/auth/verify-email.jpg"
      title="Find your request"
      subtitle="Enter the tracking code you wrote down and the phone number you gave with the request"
      footer={
        <>
          No request yet? <Link href="/request">Request a service</Link>
        </>
      }
    >
      {left ? (
        <p className="notice notice--success" role="status" style={{ marginTop: 24 }}>
          This phone no longer opens your request. Your tracking code still works.
        </p>
      ) : null}
      <FindRequestForm />
      <WhatsAppButton />
    </AuthShell>
  );
}
