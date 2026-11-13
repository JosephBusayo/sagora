import type { Metadata } from "next";
import { randomUUID } from "node:crypto";
import { DISTRICTS, SERVICES, getApprovedBusiness } from "@/lib/business";
import { RequestEntry } from "@/components/requests/RequestEntry";
import { SiteNav } from "@/components/requests/SiteNav";
import { redirect } from "next/navigation";
import { signedInFarmer } from "@/lib/session";
import { voiceIntakeConfigured } from "@/lib/voice-intake";
import { nudge } from "@/lib/outbox";

export const metadata: Metadata = { title: "Make a quick request" };
export const dynamic = "force-dynamic";
/** The voice note is transcribed by a server action posted to this route, and Gemini gives itself
 * 45 seconds. This caps the request a little above that: without it the platform default let a
 * stalled call run for a full five minutes before killing it, which the farmer saw as a crash. */
export const maxDuration = 60;

/**
 * "Make a quick request", without an account: the landing page's nav, then the choice between a
 * voice note and a form, plain on the page (Figma 152:107/267/546). No card around it, no
 * "find your request" link — neither is in the design. The farmer gets a tracking code on sending.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ service?: string; provider?: string }> }) {
  const { service: asked = "", provider } = await searchParams;
  const service = SERVICES.some((s) => s.id === asked) ? asked : "";
  // A farmer with an account books from their own home, where the request is kept with the others.
  if (await signedInFarmer()) redirect(service ? `/farmer/book?service=${service}` : "/farmer/book");
  const chosen = provider ? await getApprovedBusiness(provider) : null;
  const direct = chosen ? { id: chosen.id, name: chosen.name } : undefined;
  nudge();
  return (
    <div className="quick-request">
      <SiteNav />
      <main className="quick-request__main">
        <RequestEntry services={SERVICES} districts={DISTRICTS} service={service} direct={direct} submissionKey={randomUUID()} guest cancelHref="/" voiceEnabled={voiceIntakeConfigured()} />
      </main>
    </div>
  );
}
