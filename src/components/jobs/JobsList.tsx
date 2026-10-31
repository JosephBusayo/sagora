"use client";

import { EmptyState } from "@/components/app/EmptyState";
import { PendingButton } from "@/components/app/PendingButton";
import { useModal } from "@/components/app/useModal";
import { useRef, useState } from "react";
import { Icon, ServiceIcon, type IconName } from "@/components/app/Icon";
import { ScheduleModal } from "./ScheduleModal";
import { ReportModal } from "./ReportModal";
import { noReplacementAction, startWorkAction } from "@/app/provider/(app)/jobs/actions";

export type Option = { id: string; label: string };
export type JobView = {
  id: string; reference: string; service: string; serviceLabel: string; district: string; village: string; acres: number;
  status: string; statusLabel: string; startDate: string | null; endDate: string | null;
  assetNames: string[]; operatorName: string | null; atRisk: { name: string; why: string }[];
  reportedAcres: number | null; workNote: string; concern: string;
  privateCustomer: string | null; changes: string[];
  schedule: { startDate: string; endDate: string; operatorId: string; assetIds: string[] };
};

const PILL: Record<string, string> = {
  unscheduled: "awaiting_quotes",
  scheduled: "quotes_sent",
  in_progress: "in_progress",
  work_reported: "in_progress",
  completed: "completed",
  disputed: "cancelled",
  cancelled: "cancelled",
};

export function JobsList({ jobs, assets, operators, canEdit }: {
  jobs: JobView[]; assets: Option[]; operators: Option[]; canEdit: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [scheduling, setScheduling] = useState<JobView | null>(null);
  const [reporting, setReporting] = useState<JobView | null>(null);
  // Looked up each render, so the dialog shows the new state after an action.
  const open = jobs.find((j) => j.id === openId) ?? null;

  if (jobs.length === 0) {
    return <div className="table-card"><EmptyState icon="jobs" body="No work yet. A job appears here when a farmer accepts your quote, or when you add a private job." href="/provider/requests" action="See requests" /></div>;
  }

  return (
    <>
      <div className="table-card">
        <table className="table table--jobs">
          <thead>
            <tr>
              <th scope="col">Request</th>
              <th scope="col">Service</th>
              <th scope="col">Location</th>
              <th scope="col">Scheduled date</th>
              <th scope="col">Status</th>
              <th scope="col"><span className="sr-only">Open</span></th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((j) => (
              <tr key={j.id}>
                <td><span className="table__person"><ServiceIcon service={j.service} /><span>{j.reference}{j.privateCustomer ? <span className="table__tag">Private job · {j.privateCustomer}</span> : null}</span></span></td>
                <td>{j.serviceLabel}</td>
                <td>{j.district}</td>
                <td>{j.startDate ?? "Not scheduled"}</td>
                <td><span className={`pill pill--${PILL[j.status]}`}>{j.statusLabel}</span></td>
                <td className="table__actions">
                  <button type="button" className="icon-button" onClick={() => setOpenId(j.id)} aria-label={`Open job ${j.reference}`}>
                    <Icon name="chevron" size={24} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open ? <JobModal job={open} canEdit={canEdit} onClose={() => setOpenId(null)} onSchedule={(j) => { setOpenId(null); setScheduling(j); }} onReport={(j) => { setOpenId(null); setReporting(j); }} /> : null}
      {scheduling ? <ScheduleModal job={scheduling} assets={assets} operators={operators} onClose={() => setScheduling(null)} /> : null}
      {reporting ? <ReportModal job={reporting} onClose={() => setReporting(null)} /> : null}
    </>
  );
}

function Row({ icon, label, value }: { icon: IconName; label: string; value: string }) {
  return (
    <div className="detail-row">
      <span className="detail-row__label"><Icon name={icon} size={18} />{label}</span>
      <span className="detail-row__value">{value}</span>
    </div>
  );
}

function JobModal({ job: j, canEdit, onClose, onSchedule, onReport }: {
  job: JobView; canEdit: boolean; onClose: () => void;
  onSchedule: (j: JobView) => void; onReport: (j: JobView) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useModal(ref, onClose);
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal modal--request" role="dialog" aria-modal="true" aria-label={`Job ${j.reference}`} ref={ref}>
        <div className="modal__banner" aria-hidden="true">
          <span className="banner__ring banner__outer" />
          <span className="banner__ring banner__mid" />
          <span className="banner__ring banner__inner"><Icon name="quotes" size={34} /></span>
        </div>
        <article className="asset asset--plain">
          <div className="detail-head">
            <div>
              <h2>{j.reference}</h2>
              <p>{j.serviceLabel} job</p>
            </div>
            <span className={`pill pill--${PILL[j.status]}`}>{j.statusLabel}</span>
          </div>
          <div className="detail-list">
            <Row icon="serviceType" label="Service type" value={j.serviceLabel} />
            <Row icon="farmSize" label="Farm size" value={`${j.acres} acres`} />
            <Row icon="calendar" label="Scheduled date" value={j.startDate ? `${j.startDate} to ${j.endDate}` : "Not scheduled"} />
            <Row icon="pin" label="District" value={j.district} />
            <Row icon="village" label="Community / Village" value={j.village} />
            {j.privateCustomer ? <Row icon="user" label="Private job" value={j.privateCustomer} /> : null}
          </div>

          {j.assetNames.length > 0 ? (
            <p className="asset__notes">
              <strong>Committed:</strong> {j.assetNames.join(", ")}
              {j.operatorName ? ` · Operator: ${j.operatorName}` : ""}
            </p>
          ) : null}

          {j.atRisk.length > 0 ? (
            <p className="notice notice--error" role="status">
              At risk: {j.atRisk.map((a) => `${a.name} (${a.why.toLowerCase()})`).join(", ")}. The commitment is kept
              — replace the machine or move the dates.
            </p>
          ) : null}
          {j.atRisk.length > 0 && canEdit && !j.privateCustomer ? (
            <form action={noReplacementAction}>
              <input type="hidden" name="jobId" value={j.id} />
              <PendingButton className="resend__button">No replacement available</PendingButton>
            </form>
          ) : null}
          {j.changes.length > 0 ? <p className="field__helper">Changes: {j.changes.join(" · ")}</p> : null}

          {j.status === "work_reported" ? (
            <p className="field__helper">
              You reported {j.reportedAcres} acres. Waiting for the farmer to confirm.
            </p>
          ) : null}
          {j.status === "disputed" ? (
            <p className="notice notice--error" role="status">The farmer raised a concern: {j.concern}</p>
          ) : null}
          {j.status === "completed" ? (
            <p className="field__helper">{j.privateCustomer ? `Finished: ${j.reportedAcres} acres.` : `The farmer confirmed ${j.reportedAcres} acres.`}</p>
          ) : null}

          {canEdit ? (
            <div className="setup__buttons">
              {["unscheduled", "scheduled", "in_progress"].includes(j.status) ? (
                <button type="button" className="button button--ghost" onClick={() => onSchedule(j)}>
                  {j.status === "unscheduled" ? "Schedule" : "Change plan"}
                </button>
              ) : null}
              {j.status === "scheduled" ? (
                <form action={startWorkAction}>
                  <input type="hidden" name="jobId" value={j.id} />
                  <PendingButton className="button button--ghost">Start work</PendingButton>
                </form>
              ) : null}
              {["scheduled", "in_progress"].includes(j.status) ? (
                <button type="button" className="button" onClick={() => onReport(j)}>Report work done</button>
              ) : null}
            </div>
          ) : null}

          <div className="form-actions">
            <button type="button" className="button button--soft" onClick={close}>Close</button>
          </div>
        </article>
      </div>
    </div>
  );
}
