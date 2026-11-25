"use client";

import { CheckFirst } from "@/components/app/CheckFirst";
import { today } from "@/components/app/today";
import { useSafely } from "@/components/app/safely";
import { FormNotice } from "@/components/app/FormNotice";
import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Field } from "@/components/auth/Field";
import { sendQuoteAction } from "@/app/(platform)/provider/(app)/requests/quote-actions";
import type { FormState } from "@/lib/auth-flows";
import { ZONE } from "@/lib/zone";

export type MyQuote = {
  version: number;
  status: string;
  amount: string;        // already formatted for display
  amountInput: string;   // plain number for the form
  includes: string;
  startDate: string;
  validUntil: string;
  note: string;
  statusLabel: string;
  expired: boolean;
  /** Days the work was quoted to take, and the last day it would run. */
  days: number;
  endDate: string;
  /** The machines this quote names, as ids for the form and as text for reading back. */
  assetIds: string[];
  assetNames: string;
  /** The rate behind the total: days times rate is amount. */
  dailyRate: string;
  dailyRateInput: string;
  /** The operator held with the machines. */
  operatorId: string;
  operatorName: string;
  /** When this quote stops being acceptable, as an instant and as words. */
  expiresAt: string;
  expiresAtLabel: string;
  /** Set when what this quote reserved is no longer held for those dates. */
  clash: string | null;
};

/** One stage of the request, for a package. A single-service request has one of these. */
export type QuotableStage = {
  id: string; service: string; serviceLabel: string; sequence: number;
  /** What this quote already said about this stage, when replacing one. */
  startDate?: string; days?: number; amountInput?: string; dailyRateInput?: string;
};

/** One of the provider's machines, as the quote form offers it. */
export type QuotableAsset = { id: string; name: string; detail: string };
/** Somebody on the team who can actually be committed to the dates. */
export type QuotableOperator = { id: string; name: string; detail: string };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" formNoValidate className="button" disabled={pending} aria-busy={pending}>
      {pending ? "Sending…" : label}
    </button>
  );
}

function DateField({ name, label, defaultValue, error, helper }: {
  name: string; label: string; defaultValue?: string; error?: string; helper?: string;
}) {
  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={`q-${name}`}>{label}</label>
      <div className="field__box">
        <input id={`q-${name}`} name={name} type="date" min={today()} suppressHydrationWarning className="field__input" defaultValue={defaultValue} />
      </div>
      {error ? <p className="field__error">{error}</p> : helper ? <p className="field__helper">{helper}</p> : null}
    </div>
  );
}

/** The example matches the work, so a harvesting quote is not prompted with a plough. */
const COVERS_EXAMPLE: Record<string, string> = {
  ploughing: "Tractor, plough and operator",
  harvesting: "Harvester, operator and fuel",
  planting: "Tractor, planter and operator",
};

export function QuoteForm({ requestId, service, stages, existing, assets, operators, responseHours, onDone }: {
  requestId: string; service: string; existing: MyQuote | null;
  /**
   * Every stage the farmer asked for, in the order the work has to happen.
   *
   * One stage and the form is exactly what it was: one price, one start, one number of days. More
   * than one and each gets its own window and its own price — "plan each operation and reserve its
   * resources for its own window" (Karim's handover, 23 November 2026).
   */
  stages: readonly QuotableStage[];
  assets: readonly QuotableAsset[];
  operators: readonly QuotableOperator[];
  /** How long the farmer has to answer, so the form says the same number the rules enforce. */
  responseHours: number;
  onDone: () => void;
}) {
  const [state, action] = useActionState(useSafely(sendQuoteAction), {} as FormState);
  // The toast says it worked, and the list behind is what changed.
  useEffect(() => {
    if (state.notice) onDone();
  }, [state.notice, onDone]);
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const locked = existing && (existing.status === "accepted" || existing.status === "not_selected");
  // A rejected post hands back the ids it had; otherwise start from the quote being replaced.
  const chosen = new Set(v.assetIds !== undefined ? v.assetIds.split(",").filter(Boolean) : existing?.assetIds ?? []);
  const pack = stages.length > 1;

  if (locked) {
    return (
      <div className="quote-summary">
        <p className={`pill pill--${existing.status === "accepted" ? "quotes_sent" : "cancelled"}`}>{existing.statusLabel}</p>
        <dl className="setup__summary">
          {/* Daily rate, then the total it comes to (Joseph, 25 Nov 2026). */}
          {existing.dailyRate ? <><dt>Daily rate</dt><dd>{existing.dailyRate}</dd></> : null}
          <dt>Total price</dt><dd>{existing.amount}</dd>
          <dt>Covers</dt><dd>{existing.includes}</dd>
          <dt>Can start</dt><dd>{existing.startDate}</dd>
          <dt>Days to finish</dt><dd>{existing.days}</dd>
          {existing.assetNames ? <><dt>Equipment</dt><dd>{existing.assetNames}</dd></> : null}
          <dt>Version</dt><dd>{existing.version}</dd>
        </dl>
        <p className="field__helper">
          {existing.status === "accepted"
            ? "The farmer accepted this exact version. It cannot be changed."
            : "The farmer chose another provider."}
        </p>
      </div>
    );
  }

  return (
    <form action={action} className="form-soft quote-form">
      <CheckFirst title="Check your quote" action={existing ? "Replace quote" : "Send quote"} />
      <input type="hidden" name="requestId" value={requestId} />
      {existing ? (
        <p className="notice notice--success" role="status">
          {existing.expired
            ? `Your quote (version ${existing.version}) expired after ${responseHours} hours without an answer. Sending again replaces it with a new version.`
            : `You quoted ${existing.amount} (version ${existing.version}). Sending again replaces it with a new version; the farmer keeps seeing what you sent until then.`}
        </p>
      ) : null}
      {existing?.clash ? (
        <p className="notice notice--error" role="alert">{existing.clash} Change the dates or the equipment before the farmer tries to accept.</p>
      ) : null}
      <Field name="includes" label="What the price covers" placeholder={COVERS_EXAMPLE[service] ?? "Equipment, operator and fuel"}
        defaultValue={v.includes ?? existing?.includes} error={e.includes} />

      {pack ? (
        /* A package: every stage priced and dated on its own. The farmer sees that harrowing is one
           day and ploughing three rather than one opaque total, and the server holds the machines
           for each window separately. */
        <fieldset className="field quote-stages">
          <legend className="field__label">Plan each stage</legend>
          <p className="field__helper">
            The farmer asked for {stages.length} operations on the same land, in this order. Leave real gaps
            between them — your equipment and operator are held for every stage, travel included.
          </p>
          {stages.map((stage) => (
            <div key={stage.id} className="quote-stages__stage">
              <h4 className="quote-stages__name">{stage.sequence}. {stage.serviceLabel}</h4>
              <div className="form-row">
                <DateField name={`stage-${stage.id}-start`} label="Starts on"
                  defaultValue={v[`stage-${stage.id}-start`] ?? stage.startDate}
                  error={e[`stage-${stage.id}-start`]} />
                <div className={`field${e[`stage-${stage.id}-days`] ? " field--invalid" : ""}`}>
                  <label className="field__label" htmlFor={`q-days-${stage.id}`}>Days</label>
                  <div className="field__box">
                    <input id={`q-days-${stage.id}`} name={`stage-${stage.id}-days`} type="number" min={1} max={120}
                      step={1} inputMode="numeric" className="field__input"
                      defaultValue={v[`stage-${stage.id}-days`] ?? (stage.days ? String(stage.days) : "1")} />
                  </div>
                  {e[`stage-${stage.id}-days`] ? <p className="field__error">{e[`stage-${stage.id}-days`]}</p> : null}
                </div>
              </div>
              <div className="form-row">
                <Field name={`stage-${stage.id}-rate`} label="Rate for one day (Le)" type="text" inputMode="numeric"
                  placeholder="750.00" defaultValue={v[`stage-${stage.id}-rate`] ?? stage.dailyRateInput}
                  error={e[`stage-${stage.id}-rate`]} />
                <Field name={`stage-${stage.id}-amount`} label="Price for this stage (Le)" type="text" inputMode="numeric"
                  placeholder="1,500.00" defaultValue={v[`stage-${stage.id}-amount`] ?? stage.amountInput}
                  error={e[`stage-${stage.id}-amount`]} />
              </div>
            </div>
          ))}
          <p className="field__helper">
            The farmer is quoted the stages added up, plus Sagora&rsquo;s service fee. You keep every stage price in full.
          </p>
        </fieldset>
      ) : (
        <>
          {/* Days times rate is the total. Karim's handover asks for all three on the record —
              "numeric working days, daily rate and service total" — and the rate comes first,
              because it is the figure a provider actually knows and the total is what it adds up
              to (Joseph, 25 Nov 2026). */}
          <Field name="dailyRate" label="Your rate for one working day (Le)" type="text" inputMode="numeric" placeholder="750.00"
            defaultValue={v.dailyRate ?? existing?.dailyRateInput} error={e.dailyRate} />
          <div className="form-row">
            <DateField name="startDate" label="Can start on" defaultValue={v.startDate ?? existing?.startDate} error={e.startDate} />
            <div className={`field${e.days ? " field--invalid" : ""}`}>
              <label className="field__label" htmlFor="q-days">Days to finish the work</label>
              <div className="field__box">
                <input id="q-days" name="days" type="number" min={1} max={120} step={1} inputMode="numeric" className="field__input"
                  defaultValue={v.days ?? (existing ? String(existing.days) : "")} />
              </div>
              {e.days ? <p className="field__error">{e.days}</p> : <p className="field__helper">Counting the start day. The farmer sees this.</p>}
            </div>
          </div>

          <Field name="amount" label="Total price (Le)" type="text" inputMode="numeric" placeholder="1,500.00"
            defaultValue={v.amount ?? existing?.amountInput} error={e.amount} />
        </>
      )}

      {/* Chosen with the price, not after the farmer has committed: the farmer compares machines
          as well as figures, and the job starts out already carrying them. */}
      <fieldset className={`field quote-assets${e.assetIds ? " field--invalid" : ""}`}>
        <legend className="field__label">Equipment you will put on this work</legend>
        {assets.length === 0 ? (
          <p className="field__helper">
            You have no equipment available for work. Add a machine, or clear its faults, before quoting.
          </p>
        ) : (
          <ul className="quote-assets__list">
            {assets.map((a) => (
              <li key={a.id}>
                <label className="readiness__item">
                  <input type="checkbox" name="assetIds" value={a.id} defaultChecked={chosen.has(a.id)} />
                  <span>
                    <strong>{a.name}</strong>
                    {a.detail ? <span className="field__helper">{a.detail}</span> : null}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {e.assetIds ? <p className="field__error">{e.assetIds}</p> : (
          <p className="field__helper">
            Sending this quote reserves what you pick here, for these dates, until the quote expires. You cannot
            quote the same machine on overlapping dates somewhere else.
          </p>
        )}
      </fieldset>
      <div className={`field${e.operatorId ? " field--invalid" : ""}`}>
        <label className="field__label" htmlFor="q-operator">Operator who will do the work</label>
        <div className="field__box">
          <select id="q-operator" name="operatorId" className="field__input"
            defaultValue={v.operatorId ?? existing?.operatorId ?? ""}>
            <option value="">Choose an operator</option>
            {operators.map((o) => (
              <option key={o.id} value={o.id}>{o.name}{o.detail ? ` — ${o.detail}` : ""}</option>
            ))}
          </select>
        </div>
        {e.operatorId ? <p className="field__error">{e.operatorId}</p> : operators.length === 0 ? (
          <p className="field__helper">
            You have nobody on your team yet. Add an operator under Team before quoting — a quote has to name
            the person who will run the machine.
          </p>
        ) : <p className="field__helper">They are held for these dates as soon as you send.</p>}
      </div>

      <div className={`field${e.note ? " field--invalid" : ""}`}>
        <label className="field__label" htmlFor="q-note">Anything the farmer should know</label>
        <div className="field__box" style={{ height: "auto", alignItems: "flex-start" }}>
          <textarea id="q-note" name="note" className="field__input" rows={2} maxLength={500}
            defaultValue={v.note ?? existing?.note} style={{ resize: "vertical" }} />
        </div>
        {e.note ? <p className="field__error">{e.note}</p> : null}
      </div>
      {/* "Require confirmation of machine condition and outside commitments at quotation, and
          recheck before dispatch." Sagora cannot see a tractor break or a neighbour borrow it, so
          the only thing standing behind a reservation is somebody having just looked — and because
          this is a statement at a known moment by a named person, it can go stale, which is what
          blocks a dispatch on a week-old assurance. */}
      <div className={`field${e.outsideCommitments ? " field--invalid" : ""}`}>
        <label className="field__label" htmlFor="q-outside">Work you have on outside Sagora, over these dates</label>
        <div className="field__box" style={{ height: "auto", alignItems: "flex-start" }}>
          <textarea id="q-outside" name="outsideCommitments" className="field__input" rows={2} maxLength={300}
            placeholder="eg: two days on my own farm the week before, nothing else"
            defaultValue={v.outsideCommitments} style={{ resize: "vertical" }} />
        </div>
        {e.outsideCommitments ? <p className="field__error">{e.outsideCommitments}</p> : (
          <p className="field__helper">Leave it empty if there is nothing. Sagora cannot see private work, so it has to ask.</p>
        )}
      </div>
      <fieldset className={`field${e.confirmCapacity ? " field--invalid" : ""}`}>
        <label className="readiness__item">
          <input type="checkbox" name="confirmCapacity" value="yes" defaultChecked={v.confirmCapacity === "yes"} />
          <span>
            <strong>I have checked these machines are in working order and free for these dates.</strong>
            <span className="field__helper">
              Confirmed {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: ZONE })}.
              You will be asked again before the work goes out.
            </span>
          </span>
        </label>
        {e.confirmCapacity ? <p className="field__error">{e.confirmCapacity}</p> : null}
      </fieldset>

      {/* Said before they send, not discovered afterwards: the window is short and it is theirs
          to plan around. It replaced the "price holds until" date they used to pick themselves. */}
      {/* Said before they send, not discovered afterwards: the window is short, their machine is
          tied up for it, and the deadline can be shorter than {responseHours} hours when the work
          starts sooner than that. */}
      <p className="field__helper">
        Sending holds your equipment and operator for {responseHours} hours, or until the work was due to start,
        whichever comes first. {existing?.expiresAtLabel
          ? `Your current quote expires ${existing.expiresAtLabel}.`
          : "If the farmer does not answer by then, the quote cannot be accepted and everything is free again."}
      </p>
      {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
      <FormNotice state={state} />
      <div className="form-actions">
        <button type="button" className="button button--soft" onClick={onDone}>Close</button>
        <Submit label={existing ? "Replace quote" : "Send a quote"} />
      </div>
    </form>
  );
}
