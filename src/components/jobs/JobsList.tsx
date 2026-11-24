"use client";

import { EmptyState } from "@/components/app/EmptyState";
import { PendingButton } from "@/components/app/PendingButton";
import { useModal } from "@/components/app/useModal";
import { useActionState, useRef, useState } from "react";
import { useSafely } from "@/components/app/safely";
import type { FormState } from "@/lib/auth-flows";
import { FormNotice } from "@/components/app/FormNotice";
import { Icon, ServiceIcon, type IconName } from "@/components/app/Icon";
import { ScheduleModal } from "./ScheduleModal";
import { ReportModal } from "./ReportModal";
import { allocateRevenueAction, mobiliseAction, noReplacementAction, readinessAction, reconfirmCapacityAction, resolveFlagAction, startWorkAction } from "@/app/(platform)/provider/(app)/jobs/actions";
import { landSize } from "@/lib/land-size";

export type Option = { id: string; label: string };
export type JobView = {
  id: string; reference: string; service: string; serviceLabel: string; district: string; village: string; acres: number;
  status: string; statusLabel: string; startDate: string | null; endDate: string | null;
  assetNames: string[]; operatorName: string | null; atRisk: { name: string; why: string }[];
  reportedAcres: number | null; workNote: string; concern: string;
  privateCustomer: string | null; changes: string[];
  schedule: { startDate: string; endDate: string; operatorId: string; assetIds: string[] };
  checks: { id: string; label: string; done: boolean }[];
  mobilisedAt: string | null; startedAt: string | null;
  /** Problems somebody has to deal with before this booking can go out, and what each one was. */
  flags: { id: string; cause: string; reason: string }[];
  /** Everything that would stop a dispatch, in the server's own words. */
  blockers: string[];
  /**
   * How this job's earnings are divided between its machines, for a job with more than one.
   *
   * `stated` is false while the even split is being assumed, which the screen says out loud: an
   * even split between a tractor and a plough is a guess, and a provider deciding where to put
   * their money should know which figures rest on one.
   */
  allocation: { stated: boolean; shares: { equipmentId: string; name: string; percent: number }[] };
};

/**
 * How a provider answers a flag.
 *
 * The text is not optional, here or on the server: a flag that can be cleared with one click is a
 * flag that gets cleared without being read, and what was actually done is part of the job's record
 * and part of what a dispute would turn on.
 */
function ResolveFlag({ flagId }: { flagId: string }) {
  const [state, action] = useActionState(useSafely(resolveFlagAction), {} as FormState);
  return (
    <form action={action} className="flags__resolve">
      <input type="hidden" name="flagId" value={flagId} />
      <label className="field__label" htmlFor={`fix-${flagId}`}>What you did about it</label>
      <div className="field__box">
        <input id={`fix-${flagId}`} name="resolution" className="field__input" maxLength={200}
          placeholder="eg: moved it to Tractor B, farmer told" />
      </div>
      {state.error ? <p className="field__error">{state.error}</p> : null}
      <PendingButton className="button button--soft">Record it</PendingButton>
    </form>
  );
}

/**
 * Who earned what on a job that used more than one machine.
 *
 * Offered only once the work is done, because before that there is nothing to divide and asking
 * would be noise. Percentages are allowed to come to less than a hundred: see A14 and the notice
 * the action returns.
 */
function AllocateRevenue({ j }: { j: JobView }) {
  const [state, action] = useActionState(useSafely(allocateRevenueAction), {} as FormState);
  const e = state.fieldErrors ?? {};
  return (
    <details className="allocate">
      <summary>Who earned what on this job</summary>
      <form action={action} className="form-soft">
        <input type="hidden" name="jobId" value={j.id} />
        <p className="field__helper">
          {j.allocation.stated
            ? "You have set these shares."
            : "Split evenly at the moment, because nobody has said otherwise."}
          {" "}They may come to less than 100% — whatever is left shows as “not allocated” in Reports
          rather than being added to a machine.
        </p>
        {j.allocation.shares.map((sh) => (
          <div key={sh.equipmentId} className={`field${e[`share-${sh.equipmentId}`] ? " field--invalid" : ""}`}>
            <label className="field__label" htmlFor={`share-${j.id}-${sh.equipmentId}`}>{sh.name}</label>
            <div className="field__box">
              <input id={`share-${j.id}-${sh.equipmentId}`} name={`share-${sh.equipmentId}`} type="number"
                min={0} max={100} step="0.01" inputMode="decimal" className="field__input"
                defaultValue={String(sh.percent)} />
              <span className="field__suffix" aria-hidden="true">%</span>
            </div>
            {e[`share-${sh.equipmentId}`] ? <p className="field__error">{e[`share-${sh.equipmentId}`]}</p> : null}
          </div>
        ))}
        {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
        <FormNotice state={state} />
        <PendingButton className="button button--soft">Save the split</PendingButton>
      </form>
    </details>
  );
}

const PILL: Record<string, string> = {
  unscheduled: "awaiting_quotes",
  scheduled: "quotes_sent",
  in_progress: "in_progress",
  work_reported: "in_progress",
  completed: "completed",
  disputed: "cancelled",
  cancelled: "cancelled",
};

export function JobsList({ jobs, assets, operators, canEdit, initialOpen }: {
  jobs: JobView[]; assets: Option[]; operators: Option[]; canEdit: boolean; initialOpen?: string;
}) {
  const [openId, setOpenId] = useState<string | null>(jobs.find((j) => j.reference === initialOpen)?.id ?? null);
  const [scheduling, setScheduling] = useState<JobView | null>(null);
  const [reporting, setReporting] = useState<JobView | null>(null);
  // Looked up each render, so the dialog shows the new state after an action.
  const open = jobs.find((j) => j.id === openId) ?? null;

  if (jobs.length === 0) {
    return <div className="table-card"><EmptyState icon="jobs" title="No jobs yet" body="A job appears here when a farmer accepts your quote, or when you add a private job." href="/provider/requests" action="See requests" /></div>;
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
            <Row icon="farmSize" label="Farm size" value={landSize(j.acres)} />
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
              — replace the equipment or move the dates.
            </p>
          ) : null}
          {j.atRisk.length > 0 && canEdit && !j.privateCustomer ? (
            <form action={noReplacementAction}>
              <input type="hidden" name="jobId" value={j.id} />
              <PendingButton className="resend__button">No replacement available</PendingButton>
            </form>
          ) : null}
          {/* "A new blocking fault must flag existing bookings for action rather than cancelling them
              silently." The booking is still here; somebody has to say what they are doing about it,
              and until they do the equipment does not leave. */}
          {j.flags.length > 0 ? (
            <div className="flags">
              <p className="notice notice--warn" role="status">
                {j.flags.length === 1 ? "This booking needs attention" : `${j.flags.length} problems on this booking`}.
                It has not been cancelled — swap the machine, move the dates, or cancel it and tell the farmer.
              </p>
              <ul className="flags__list">
                {j.flags.map((f) => (
                  <li key={f.id}>
                    <strong>{f.reason}</strong>
                    {canEdit ? <ResolveFlag flagId={f.id} /> : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {/* "Capacity that has gone stale stays blocked until it is confirmed again." Shown as the
              one-click way out rather than as a dead end. */}
          {canEdit && j.status === "scheduled" && !j.mobilisedAt
            && j.blockers.some((b) => b.includes("gone stale")) ? (
            <form action={reconfirmCapacityAction} className="flags__confirm">
              <input type="hidden" name="jobId" value={j.id} />
              <p className="field__helper">
                Your last check on these machines has gone stale. Look at them again before they go out.
              </p>
              <PendingButton className="button button--soft">They are working and free</PendingButton>
            </form>
          ) : null}
          {j.changes.length > 0 ? <p className="field__helper">Changes: {j.changes.join(" · ")}</p> : null}

          {j.status === "scheduled" && !j.mobilisedAt ? (
            <form action={readinessAction} className="readiness">
              <input type="hidden" name="jobId" value={j.id} />
              <p className={`notice ${j.checks.every((c) => c.done) ? "notice--success" : "notice--warn"}`} role="status">
                {j.checks.every((c) => c.done) ? "Ready for dispatch." : "Not ready for dispatch. Tick each item once it is true."}
              </p>
              <fieldset disabled={!canEdit}>
                <legend className="field__label">Before the equipment leaves</legend>
                {j.checks.map((c) => (
                  <label key={c.id} className="readiness__item">
                    <input type="checkbox" name="check" value={c.id} defaultChecked={c.done} /> {c.label}
                  </label>
                ))}
              </fieldset>
              {canEdit ? <PendingButton className="button button--soft">Save readiness</PendingButton> : null}
            </form>
          ) : null}
          {j.mobilisedAt ? <p className="field__helper">Equipment on the way since {j.mobilisedAt}.{j.startedAt ? ` Work started ${j.startedAt}.` : ""}</p> : null}

          {j.status === "work_reported" ? (
            <p className="field__helper">
              You reported {landSize(j.reportedAcres)}. Waiting for the farmer to confirm.
            </p>
          ) : null}
          {j.status === "disputed" ? (
            <p className="notice notice--error" role="status">The farmer raised a concern: {j.concern}</p>
          ) : null}
          {j.status === "completed" ? (
            <p className="field__helper">{j.privateCustomer ? `Finished: ${landSize(j.reportedAcres)}.` : `The farmer confirmed ${landSize(j.reportedAcres)}.`}</p>
          ) : null}
          {/* A14. Only for a finished job with more than one machine on it: one machine earned the
              lot and there is nothing to divide. */}
          {j.status === "completed" && canEdit && j.allocation.shares.length > 1 ? (
            <AllocateRevenue j={j} />
          ) : null}

          {canEdit ? (
            <div className="setup__buttons">
              {["unscheduled", "scheduled", "in_progress"].includes(j.status) ? (
                <button type="button" className="button button--ghost" onClick={() => onSchedule(j)}>
                  {j.status === "unscheduled" ? "Schedule" : "Change plan"}
                </button>
              ) : null}
              {/* The checklist is no longer the only gate: an open flag, a machine that cannot work
                  and a stale capacity check each stop a dispatch, and the button is hidden rather
                  than offered and then refused. */}
              {j.status === "scheduled" && !j.mobilisedAt && j.checks.every((c) => c.done)
                && j.blockers.length === 0 ? (
                <form action={mobiliseAction}>
                  <input type="hidden" name="jobId" value={j.id} />
                  <PendingButton className="button button--ghost">Equipment on the way</PendingButton>
                </form>
              ) : null}
              {j.status === "scheduled" && j.mobilisedAt ? (
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
