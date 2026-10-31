"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/app/Icon";
import { QuoteForm, type MyQuote } from "./QuoteForm";

export type RequestDetail = {
  id: string;
  reference: string;
  serviceLabel: string;
  acres: number;
  landAccess: string;
  landCondition: string;
  landClearance: string;
  crop: string;
  direct: boolean;
  preferredDate: string;
  alternateDate: string | null;
  district: string;
  village: string;
  notes: string;
  submittedOn: string;
  service: string;
  activity: { when: string; text: string }[];
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
    </>
  );
}

export function RequestModal({ request, myQuote, onClose }: { request: RequestDetail; myQuote: MyQuote | null; onClose: () => void }) {
  const [tab, setTab] = useState<"details" | "quote" | "activity">("details");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("button")?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
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
            <QuoteForm requestId={request.id} existing={myQuote} onDone={onClose} />
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
          <Row icon="farmSize" label="Farm size" value={`${request.acres} acres`} />
          <LandRows request={request} />
          <Row icon="calendar" label="Preferred date" value={request.preferredDate} />
          <Row icon="calendarAlt" label="Alternate date" value={request.alternateDate ?? "Not given"} />
          <Row icon="pin" label="District" value={request.district} />
          <Row icon="village" label="Community / Village" value={request.village} />
          <Row icon="info" label="Additional information" value={request.notes || "None"} />
        </div>

        <div className="form-actions">
          <button type="button" className="button button--soft" onClick={onClose}>Close</button>
          <button type="button" className="button" onClick={() => setTab("quote")}>
            {myQuote && myQuote.status === "sent" ? "Update my quote" : "Send a quote"}
          </button>
        </div>
        </>
        )}
      </div>
    </div>
  );
}
