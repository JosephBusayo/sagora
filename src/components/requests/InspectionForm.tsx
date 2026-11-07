"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { useSafely } from "@/components/app/safely";
import { FormNotice } from "@/components/app/FormNotice";
import { saveInspectionAction } from "@/app/(platform)/provider/(app)/requests/quote-actions";
import type { FormState } from "@/lib/auth-flows";

export type MyInspection = { status: "required" | "scheduled" | "completed"; scheduledFor: string; findings: string; openQuestions: string } | null;

const CHOICES = [
  { id: "none", label: "No inspection needed" },
  { id: "required", label: "Inspection needed" },
  { id: "scheduled", label: "Inspection booked" },
  { id: "completed", label: "Inspection done" },
] as const;

function Save() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="button button--soft" disabled={pending} aria-busy={pending}>
      {pending ? "Saving…" : "Save inspection"}
    </button>
  );
}

/**
 * Whether this provider needs to see the farm first (UC08). Kept on the request, above the quote,
 * because the quote cannot be sent while it is open.
 */
export function InspectionForm({ requestId, existing }: { requestId: string; existing: MyInspection }) {
  const [state, action] = useActionState(useSafely(saveInspectionAction), {} as FormState);
  const v = state.values ?? {};
  const [status, setStatus] = useState<string>(v.status ?? existing?.status ?? "none");
  const e = state.fieldErrors ?? {};
  return (
    <details className="inspection" open={status !== "none"}>
      <summary>Farm inspection{existing ? `: ${CHOICES.find((c) => c.id === existing.status)?.label}` : ""}</summary>
      <form action={action} className="form-soft inspection__form">
        <input type="hidden" name="requestId" value={requestId} />
        <div className="field">
          <label className="field__label" htmlFor="i-status">Do you need to see the farm before pricing?</label>
          <div className="field__box">
            <select id="i-status" name="status" className="field__input" value={status} onChange={(ev) => setStatus(ev.target.value)}>
              {CHOICES.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </div>
        </div>
        {status === "scheduled" || status === "completed" ? (
          <div className={`field${e.scheduledFor ? " field--invalid" : ""}`}>
            <label className="field__label" htmlFor="i-date">{status === "completed" ? "Inspected on" : "Inspection date"}</label>
            <div className="field__box">
              <input id="i-date" name="scheduledFor" type="date" className="field__input" defaultValue={v.scheduledFor ?? existing?.scheduledFor} suppressHydrationWarning />
            </div>
            {e.scheduledFor ? <p className="field__error">{e.scheduledFor}</p> : null}
          </div>
        ) : null}
        {status === "completed" ? (
          <>
            <div className={`field${e.findings ? " field--invalid" : ""}`}>
              <label className="field__label" htmlFor="i-findings">What you found</label>
              <div className="field__box field__box--area">
                <textarea id="i-findings" name="findings" className="field__input" rows={2} maxLength={500}
                  placeholder="eg: water is ankle deep at the south end, rice ready in 10 days" defaultValue={v.findings ?? existing?.findings} />
              </div>
              {e.findings ? <p className="field__error">{e.findings}</p> : null}
            </div>
            <div className="field">
              <label className="field__label" htmlFor="i-open">Questions still open (leave empty when none)</label>
              <div className="field__box field__box--area">
                <textarea id="i-open" name="openQuestions" className="field__input" rows={2} maxLength={500}
                  defaultValue={v.openQuestions ?? existing?.openQuestions} />
              </div>
            </div>
          </>
        ) : null}
        {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
        <FormNotice state={state} />
        <div className="form-actions"><Save /></div>
      </form>
    </details>
  );
}
