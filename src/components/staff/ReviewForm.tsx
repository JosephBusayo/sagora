"use client";

import { useSafely } from "@/components/app/safely";
import { FormNotice } from "@/components/app/FormNotice";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { reviewBusiness } from "@/app/staff/actions";
import type { FormState } from "@/app/provider/actions";

function Buttons() {
  const { pending } = useFormStatus();
  return (
    <div className="setup__buttons">
      <button name="decision" value="approved" className="button" disabled={pending}>Approve</button>
      <button name="decision" value="changes_requested" className="button button--ghost" disabled={pending}>Ask for changes</button>
      <button name="decision" value="rejected" className="button button--ghost" disabled={pending}>Reject</button>
    </div>
  );
}

/** One business's decision. Every outcome is shown, so nothing fails silently. */
export function ReviewForm({ id }: { id: string }) {
  const [state, action] = useActionState(useSafely(reviewBusiness), {} as FormState);
  return (
    <form action={action} className="staff__form">
      <input type="hidden" name="id" value={id} />
      <label className="field__label" htmlFor={`n-${id}`}>Note to the provider (required unless approving)</label>
      <textarea id={`n-${id}`} name="note" rows={2} maxLength={500} className="staff__note" />
      {state.fieldErrors?.note ? <p className="field__error">{state.fieldErrors.note}</p> : null}
      {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
      <FormNotice state={state} />
      <Buttons />
    </form>
  );
}
