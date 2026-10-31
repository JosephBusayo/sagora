"use client";

import { today } from "@/components/app/today";
import { useSafely } from "@/components/app/safely";
import { FormNotice } from "@/components/app/FormNotice";
import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { Field } from "@/components/auth/Field";
import { sendQuoteAction } from "@/app/provider/(app)/requests/quote-actions";
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
};

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

export function QuoteForm({ requestId, existing, onDone }: { requestId: string; existing: MyQuote | null; onDone: () => void }) {
  const [state, action] = useActionState(useSafely(sendQuoteAction), {} as FormState);
  // The toast says it worked, and the list behind is what changed.
  useEffect(() => {
    if (state.notice) onDone();
  }, [state.notice, onDone]);
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
  const locked = existing && (existing.status === "accepted" || existing.status === "not_selected");

  if (locked) {
    return (
      <div className="quote-summary">
        <p className={`pill pill--${existing.status === "accepted" ? "quotes_sent" : "cancelled"}`}>{existing.statusLabel}</p>
        <dl className="setup__summary">
          <dt>Price</dt><dd>{existing.amount}</dd>
          <dt>Covers</dt><dd>{existing.includes}</dd>
          <dt>Can start</dt><dd>{existing.startDate}</dd>
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
      <input type="hidden" name="requestId" value={requestId} />
      {existing ? (
        <p className="notice notice--success" role="status">
          {existing.expired
            ? `Your quote (version ${existing.version}) has expired. Sending again replaces it with a new version.`
            : `You quoted ${existing.amount} (version ${existing.version}). Sending again replaces it with a new version; the farmer keeps seeing what you sent until then.`}
        </p>
      ) : null}
      <Field name="amount" label="Total price (Le)" type="text" inputMode="numeric" placeholder="1,500.00"
        defaultValue={v.amount ?? existing?.amountInput} error={e.amount} />
      <Field name="includes" label="What the price covers" placeholder="Tractor, plough and operator"
        defaultValue={v.includes ?? existing?.includes} error={e.includes} />
      <div className="form-row">
        <DateField name="startDate" label="Can start on" defaultValue={v.startDate ?? existing?.startDate} error={e.startDate} />
        <DateField name="validUntil" label="Price holds until" defaultValue={v.validUntil ?? existing?.validUntil} error={e.validUntil}
          helper="On or before the start date" />
      </div>
      <div className={`field${e.note ? " field--invalid" : ""}`}>
        <label className="field__label" htmlFor="q-note">Anything the farmer should know</label>
        <div className="field__box" style={{ height: "auto", alignItems: "flex-start" }}>
          <textarea id="q-note" name="note" className="field__input" rows={2} maxLength={500}
            defaultValue={v.note ?? existing?.note} style={{ resize: "vertical" }} />
        </div>
        {e.note ? <p className="field__error">{e.note}</p> : null}
      </div>
      {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
      <FormNotice state={state} />
      <div className="form-actions">
        <button type="button" className="button button--soft" onClick={onDone}>Close</button>
        <Submit label={existing ? "Replace quote" : "Send a quote"} />
      </div>
    </form>
  );
}
