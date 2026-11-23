"use client";

import { useActionState, useEffect, useState } from "react";
import { useFormStatus } from "react-dom";
import { useSafely } from "@/components/app/safely";
import { FormNotice } from "@/components/app/FormNotice";
import { saveInspectionAction } from "@/app/(platform)/provider/(app)/requests/quote-actions";
import type { FormState } from "@/lib/auth-flows";

export type MyInspection = {
  status: "required" | "scheduled" | "completed"; scheduledFor: string; findings: string; openQuestions: string;
  /** A day the farmer put forward, waiting on this provider to confirm it. */
  proposedFor: string;
} | null;

const CHOICES = [
  { id: "none", label: "No inspection needed" },
  { id: "required", label: "Inspection needed" },
  { id: "scheduled", label: "Inspection booked" },
  { id: "completed", label: "Inspection done" },
] as const;

/** Where the visit has got to, once the provider has said one is needed. */
const PROGRESS = CHOICES.filter((c) => c.id !== "none");

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
export function InspectionForm({ requestId, existing, onChange }: {
  requestId: string; existing: MyInspection;
  /** Told what was saved, so the screen around this can drop the price fields at once. */
  onChange?: (next: MyInspection) => void;
}) {
  const [state, action] = useActionState(useSafely(saveInspectionAction), {} as FormState);
  const v = state.values ?? {};
  const [status, setStatus] = useState<string>(v.status ?? existing?.status ?? "none");
  const e = state.fieldErrors ?? {};

  // Whether a quote may be sent turns on what was just saved here, so the answer is passed up
  // rather than waiting for the next page load to reveal it.
  useEffect(() => {
    if (!state.notice || !onChange) return;
    const saved = state.values ?? {};
    onChange(
      saved.status === "none" || !saved.status ? null : {
        status: saved.status as NonNullable<MyInspection>["status"],
        scheduledFor: saved.scheduledFor ?? "",
        findings: saved.findings ?? "",
        openQuestions: saved.openQuestions ?? "",
        proposedFor: saved.status === "required" ? existing?.proposedFor ?? "" : "",
      },
    );
  }, [state.notice, state.values, onChange, existing?.proposedFor]);

  return (
    <details className="inspection" open={status !== "none"}>
      <summary>Farm inspection{existing ? `: ${CHOICES.find((c) => c.id === existing.status)?.label}` : ""}</summary>
      <form action={action} className="form-soft inspection__form">
        <input type="hidden" name="requestId" value={requestId} />
        {/* The decision and the progress through it are two questions, not one dropdown. Karim's
            handover puts it plainly — "provider chooses inspection: record Needed or Not needed" —
            and a provider answering the first question should not have to scroll past "Inspection
            done" to say they do not need one. */}
        <fieldset className="field inspection__decide">
          <legend className="field__label">Do you need to see the farm before pricing?</legend>
          <label className="readiness__item">
            <input type="radio" name="decision" value="not_needed" checked={status === "none"}
              onChange={() => setStatus("none")} />
            <span>No, I can price it from the request</span>
          </label>
          <label className="readiness__item">
            <input type="radio" name="decision" value="needed" checked={status !== "none"}
              onChange={() => setStatus(status === "none" ? "required" : status)} />
            <span>Yes, an inspection is needed</span>
          </label>
        </fieldset>

        {/* Only once they have said yes: where the visit has got to. */}
        {status !== "none" ? (
          <div className="field">
            <label className="field__label" htmlFor="i-status">Where has the visit got to?</label>
            <div className="field__box">
              <select id="i-status" name="status" className="field__input" value={status} onChange={(ev) => setStatus(ev.target.value)}>
                {PROGRESS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <p className="field__helper">You cannot send a price until the visit is done.</p>
          </div>
        ) : (
          // The server reads `status`, so the answer still posts when the progress select is hidden.
          <input type="hidden" name="status" value="none" />
        )}
        {/* What the farmer suggested, where the provider is deciding the date. Confirming it is
            the ordinary "Inspection booked" save, so there is one way to set a date, not two. */}
        {existing?.proposedFor && status !== "completed" ? (
          <p className="notice notice--success" role="status">
            The farmer suggested {existing.proposedFor}. Choose <strong>Inspection booked</strong> to confirm that day, or set another.
          </p>
        ) : null}
        {status === "scheduled" || status === "completed" ? (
          <div className={`field${e.scheduledFor ? " field--invalid" : ""}`}>
            <label className="field__label" htmlFor="i-date">{status === "completed" ? "Inspected on" : "Inspection date"}</label>
            <div className="field__box">
              {/* Starts on the day the farmer asked for, so confirming it is one click rather
                  than retyping a date that is already on the screen. */}
              <input id="i-date" name="scheduledFor" type="date" className="field__input"
                defaultValue={v.scheduledFor ?? (existing?.scheduledFor || (status === "scheduled" ? existing?.proposedFor : ""))} suppressHydrationWarning />
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
