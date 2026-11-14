"use client";

import { useModal } from "@/components/app/useModal";
import { useRef, useState } from "react";
import { Icon, type IconName } from "@/components/app/Icon";
import { QuoteForm, type MyQuote } from "./QuoteForm";
import { InspectionForm, type MyInspection } from "./InspectionForm";
import { landSize } from "@/lib/land-size";

export type RequestDetail = {
  id: string;
  reference: string;
  serviceLabel: string;
  acres: number;
  landAccess: string;
  landCondition: string;
  landClearance: string;
  crop: string;
  extras: { label: string; value: string }[];
  missing: string[];
  direct: boolean;
  preferredDate: string;
  alternateDate: string | null;
  district: string;
  chiefdom: string;
  village: string;
  notes: string;
  submittedOn: string;
  service: string;
  activity: { when: string; text: string }[];
  inspection: MyInspection;
};

function Row({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className="detail-row">
      <span className="detail-row__label"><Icon name={icon} size={18} />{label}</span>
      <span className="detail-row__value">{value}</span>
    </div>
  );
}

/** Everything about the ground that changes the price, so it stays on screen while pricing. */
function LandRows({ request }: { request: RequestDetail }) {
  return (
    <>
      {request.direct ? <Row icon="info" label="Request type" value="Direct request" /> : null}
      {request.crop ? <Row icon="info" label="Crop" value={request.crop} /> : null}
      <Row icon="info" label="Land access" value={request.landAccess} />
      <Row icon="info" label="Land condition" value={request.landCondition} />
      <Row icon="info" label="Land clearance" value={request.landClearance} />
      {request.extras.map((x) => <Row key={x.label} icon="info" label={x.label} value={x.value} />)}
      {request.missing.length ? (
        <p className="notice notice--warn request-missing" role="note">
          <strong>Ask the farmer before pricing:</strong> {request.missing.join(", ")}. The farmer did not know these.
        </p>
      ) : null}
    </>
  );
}

/** The job this request became, once a quote was accepted. Where the work is run from. */
export type RequestJob = { reference: string; scheduled: boolean };

export function RequestModal({ request, myQuote, job, onClose }: {
  request: RequestDetail; myQuote: MyQuote | null; job?: RequestJob | null; onClose: () => void;
}) {
  const [tab, setTab] = useState<"details" | "quote" | "activity">("details");
  const ref = useRef<HTMLDivElement>(null);
  const close = useModal(ref, onClose);

  // The farmer picked this business: the request is now a job, and everything left to do with
  // it — scheduling, equipment, the work report — lives there.
  const won = myQuote?.status === "accepted";
  const jobHref = job ? `/provider/jobs?open=${encodeURIComponent(job.reference)}` : "/provider/jobs";


  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal modal--request" role="dialog" aria-modal="true" aria-labelledby="req-title" ref={ref}>
        {/* Three concentric circles, each a lighter shade outwards, as in the design. */}
        <div className="modal__banner" aria-hidden="true">
          <span className="banner__ring banner__outer" />
          <span className="banner__ring banner__mid" />
          <span className="banner__ring banner__inner">
            <Icon name={request.service === "harvesting" ? "quotes" : "requests"} size={34} />
          </span>
        </div>
        <div className="tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === "details"} className={`tab${tab === "details" ? " tab--on" : ""}`} onClick={() => setTab("details")}>
            Request details
          </button>
          <button type="button" role="tab" aria-selected={tab === "quote"} className={`tab${tab === "quote" ? " tab--on" : ""}`} onClick={() => setTab("quote")}>
            My quote
          </button>
          <button type="button" role="tab" aria-selected={tab === "activity"} className={`tab${tab === "activity" ? " tab--on" : ""}`} onClick={() => setTab("activity")}>
            Activity
          </button>
        </div>

        {tab === "activity" ? (
          <>
            <ul className="activity">
              {request.activity.map((a) => (
                <li key={`${a.when}-${a.text}`}><span>{a.text}</span><span>{a.when}</span></li>
              ))}
            </ul>
            <div className="form-actions">
              <button type="button" className="button button--soft" onClick={onClose}>Close</button>
            </div>
          </>
        ) : tab === "quote" ? (
          <>
            <div className="detail-list"><LandRows request={request} /></div>
            {!myQuote || myQuote.status === "sent" || myQuote.status === "superseded" ? (
              <InspectionForm requestId={request.id} existing={request.inspection} />
            ) : null}
            {/* An accepted quote is the agreement: it is read back, not re-opened for editing.
                Sending another is refused by the server anyway, so offering the form here only
                walked a provider into a dead end. */}
            {won && myQuote ? (
              <>
                <div className="detail-list">
                  <Row icon="payments" label="Agreed price" value={myQuote.amount} />
                  <Row icon="info" label="What it covers" value={myQuote.includes} />
                  <Row icon="calendar" label="Starting" value={myQuote.startDate} />
                  {myQuote.note ? <Row icon="info" label="Your note" value={myQuote.note} /> : null}
                </div>
                <div className="form-actions">
                  <button type="button" className="button button--soft" onClick={() => setTab("details")}>Back</button>
                  <a className="button" href={jobHref}>{job?.scheduled ? "Open the job" : "Schedule the work"}</a>
                </div>
              </>
            ) : (
              <QuoteForm requestId={request.id} service={request.service} existing={myQuote} onDone={onClose} />
            )}
          </>
        ) : (
        <>
        <div className="detail-head">
          <div>
            <h2 id="req-title">{request.reference}</h2>
            <p>{request.serviceLabel} request</p>
          </div>
          <p className="detail-head__date">Submitted on {request.submittedOn}</p>
        </div>

        <div className="detail-list">
          <Row icon="serviceType" label="Service type" value={request.serviceLabel} />
          <Row icon="farmSize" label="Farm size" value={landSize(request.acres)} />
          <LandRows request={request} />
          <Row icon="calendar" label="Preferred date" value={request.preferredDate} />
          <Row icon="calendarAlt" label="Alternate date" value={request.alternateDate ?? "Not given"} />
          <Row icon="pin" label="District" value={request.district} />
          {request.chiefdom ? <Row icon="pin" label="Chiefdom" value={request.chiefdom} /> : null}
          <Row icon="village" label="Community / Village" value={request.village} />
          <Row icon="info" label="Additional information" value={request.notes || "None"} />
        </div>

        {/* Once the farmer has accepted, quoting is over and the work is the next thing. The
            button used to say "Send a quote" either way, which sent a provider to a form that
            could only refuse them, and left scheduling to be hunted for under Jobs. */}
        <div className="form-actions">
          <button type="button" className="button button--soft" onClick={onClose}>Close</button>
          {won ? (
            <a className="button" href={jobHref}>{job?.scheduled ? "Open the job" : "Schedule the work"}</a>
          ) : (
            <button type="button" className="button" onClick={() => setTab("quote")}>
              {myQuote && myQuote.status === "sent" ? "Update my quote" : "Send a quote"}
            </button>
          )}
        </div>
        </>
        )}
      </div>
    </div>
  );
}
