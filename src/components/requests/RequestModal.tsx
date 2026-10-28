"use client";

import { useEffect, useRef, useState } from "react";
import { Icon, type IconName } from "@/components/app/Icon";

export type RequestDetail = {
  id: string;
  reference: string;
  serviceLabel: string;
  acres: number;
  preferredDate: string;
  alternateDate: string | null;
  district: string;
  village: string;
  notes: string;
  submittedOn: string;
  service: string;
};

function Row({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className="detail-row">
      <span className="detail-row__label"><Icon name={icon} size={18} />{label}</span>
      <span className="detail-row__value">{value}</span>
    </div>
  );
}

export function RequestModal({ request, onClose }: { request: RequestDetail; onClose: () => void }) {
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
          {/* Quotes are the next stage; the tabs are shown so the screen matches the design. */}
          <button type="button" role="tab" aria-selected={false} className="tab" disabled title="Quotes are not built yet">My quote</button>
          <button type="button" role="tab" aria-selected={false} className="tab" disabled title="Activity is not built yet">Activity</button>
        </div>

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
          <Row icon="calendar" label="Preferred date" value={request.preferredDate} />
          <Row icon="calendarAlt" label="Alternate date" value={request.alternateDate ?? "Not given"} />
          <Row icon="pin" label="District" value={request.district} />
          <Row icon="village" label="Community / Village" value={request.village} />
          <Row icon="info" label="Additional information" value={request.notes || "None"} />
        </div>

        <div className="form-actions">
          <button type="button" className="button button--soft" onClick={onClose}>Close</button>
          <button type="button" className="button" disabled title="Quoting is the next stage">Send a quote</button>
        </div>
      </div>
    </div>
  );
}
