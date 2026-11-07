import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { GuestShell } from "@/components/guest/GuestShell";
import { PendingButton } from "@/components/app/PendingButton";
import { RequestDetail } from "@/components/requests/RequestDetail";
import { guestRequest, newCodeFor } from "@/lib/guest";
import { monimeOfferedTo } from "@/lib/monime";
import { leaveRequestAction } from "../actions";

export const metadata: Metadata = { title: "Your request" };
export const dynamic = "force-dynamic";

/** The request this browser was let into, by sending it or by its tracking code. */
export default async function Page({ searchParams }: {
  searchParams: Promise<{ accepted?: string; error?: string; confirmed?: string; concern?: string; payment?: string; saved?: string }>;
}) {
  const request = await guestRequest();
  if (!request) redirect("/request/find");
  const flags = await searchParams;
  const code = await newCodeFor(request.id);

  return (
    <GuestShell>
      {code ? (
        <section className="tracking-code" aria-labelledby="tracking-code-title">
          <p className="notice notice--success" role="status">Your request is sent. Providers who do this work will send you quotes.</p>
          <h1 id="tracking-code-title" className="tracking-code__title">Your tracking code</h1>
          <p className="tracking-code__value" data-testid="tracking-code">{code}</p>
          <p className="tracking-code__hint">Write this code down. You need it to come back to this request.</p>
        </section>
      ) : null}
      {flags.saved ? <p className="notice notice--success guest__notice" role="status">Your changes are saved.</p> : null}
      <div className="modal modal--request-page guest__panel">
        <RequestDetail
          request={request}
          flags={flags}
          online={monimeOfferedTo(request.contactEmail)}
          links={{ close: "/", edit: "/request/track/edit" }}
          noQuotes={request.contactEmail
            ? "No provider has quoted yet. We will email you when one does."
            : "No provider has quoted yet. Come back with your tracking code to see their quotes."}
        />
      </div>
      <form action={leaveRequestAction} className="guest__leave">
        <PendingButton className="button button--soft button--inline">Close this request on this phone</PendingButton>
        <p className="field__helper">Do this on a shared phone. You can open it again with your tracking code.</p>
      </form>
    </GuestShell>
  );
}
