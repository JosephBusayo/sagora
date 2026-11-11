import type { Metadata } from "next";
import Link from "next/link";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { DISTRICTS, SERVICES, getApprovedBusiness } from "@/lib/business";
import { VoiceIntake } from "@/components/requests/VoiceIntake";
import { GuestShell } from "@/components/guest/GuestShell";
import { signedInFarmer } from "@/lib/session";
import { voiceIntakeConfigured } from "@/lib/voice-intake";

export const metadata: Metadata = { title: "Send a voice note" };
export const dynamic = "force-dynamic";

/** Same request as /request, started from a voice note instead of a blank form. */
export default async function Page({ searchParams }: { searchParams: Promise<{ provider?: string }> }) {
  if (!voiceIntakeConfigured()) redirect("/request");
  const { provider } = await searchParams;
  const farmer = await signedInFarmer();
  const chosen = provider ? await getApprovedBusiness(provider) : null;
  const direct = chosen ? { id: chosen.id, name: chosen.name } : undefined;

  return (
    <GuestShell>
      <div className="modal modal--book guest__panel">
        <header className="book__head">
          <h2>Send a voice note</h2>
          <p>Record what you need, or share an existing voice note, and we will fill in the request for you.</p>
        </header>
        <VoiceIntake
          services={SERVICES} districts={DISTRICTS} direct={direct}
          submissionKey={randomUUID()} guest={!farmer} cancelHref={farmer ? "/farmer/home" : "/"}
        />
      </div>
      {!farmer ? (
        <p className="guest__note">
          Already sent a request? <Link href="/request/find">Find it here</Link>
        </p>
      ) : null}
    </GuestShell>
  );
}
