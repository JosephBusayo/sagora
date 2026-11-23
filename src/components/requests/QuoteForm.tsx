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

export function QuoteForm({ requestId, service, existing, assets, operators, responseHours, onDone }: {
  requestId: string; service: string; existing: MyQuote | null;
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

  if (locked) {
    return (
      <div className="quote-summary">
        <p className={`pill pill--${existing.status === "accepted" ? "quotes_sent" : "cancelled"}`}>{existing.statusLabel}</p>
        <dl className="setup__summary">
          <dt>Price</dt><dd>{existing.amount}</dd>
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
      <Field name="amount" label="Total price (Le)" type="text" inputMode="numeric" placeholder="1,500.00"
        defaultValue={v.amount ?? existing?.amountInput} error={e.amount} />
      <Field name="includes" label="What the price covers" placeholder={COVERS_EXAMPLE[service] ?? "Equipment, operator and fuel"}
        defaultValue={v.includes ?? existing?.includes} error={e.includes} />
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

      {/* Days times rate is the total. Karim's handover asks for all three on the record —
          "numeric working days, daily rate and service total" — and for the unit to stay
          explicit, so hectares per day is never assumed anywhere. */}
      <Field name="dailyRate" label="Your rate for one working day (Le)" type="text" inputMode="numeric" placeholder="750.00"
        defaultValue={v.dailyRate ?? existing?.dailyRateInput} error={e.dailyRate} />

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
