"use client";

import { useState } from "react";
import { Icon } from "@/components/app/Icon";
import { ScheduleModal } from "./ScheduleModal";
import { ReportModal } from "./ReportModal";
import { noReplacementAction, startWorkAction } from "@/app/provider/(app)/jobs/actions";

export type Option = { id: string; label: string };
export type JobView = {
  id: string; reference: string; service: string; serviceLabel: string; where: string; acres: number;
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
  const [scheduling, setScheduling] = useState<JobView | null>(null);
  const [reporting, setReporting] = useState<JobView | null>(null);

  if (jobs.length === 0) {
    return <div className="table-card"><p className="empty">No work yet. A job appears here when a farmer accepts your quote, or when you add a private job.</p></div>;
  }

  return (
    <>
      <div className="equipment-grid">
        {jobs.map((j) => (
          <article key={j.id} className="asset">
            <div className="asset__head">
              <span className="request-icon" aria-hidden="true">
                <Icon name={j.service === "harvesting" ? "quotes" : "equipment"} size={22} />
              </span>
              <div className="asset__title">
                <h3>{j.reference}</h3>
                <p>{j.serviceLabel} · {j.acres} acres · {j.where}</p>
                {j.privateCustomer ? <p>Private job · {j.privateCustomer}</p> : null}
              </div>
            </div>

            <p className="asset__state">
              <span className={`pill pill--${PILL[j.status]}`}>{j.statusLabel}</span>
              {j.startDate ? <span className="field__helper">{j.startDate} to {j.endDate}</span> : null}
            </p>

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
                <button type="submit" className="resend__button">No replacement available</button>
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
                  <button type="button" className="button button--ghost" onClick={() => setScheduling(j)}>
                    {j.status === "unscheduled" ? "Schedule" : "Change plan"}
                  </button>
                ) : null}
                {j.status === "scheduled" ? (
                  <form action={startWorkAction}>
                    <input type="hidden" name="jobId" value={j.id} />
                    <button type="submit" className="button button--ghost">Start work</button>
                  </form>
                ) : null}
                {["scheduled", "in_progress"].includes(j.status) ? (
                  <button type="button" className="button" onClick={() => setReporting(j)}>Report work done</button>
                ) : null}
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {scheduling ? <ScheduleModal job={scheduling} assets={assets} operators={operators} onClose={() => setScheduling(null)} /> : null}
      {reporting ? <ReportModal job={reporting} onClose={() => setReporting(null)} /> : null}
    </>
  );
}
