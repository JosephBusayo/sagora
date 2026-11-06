"use client";

import { CheckFirst } from "@/components/app/CheckFirst";
import { useSafely } from "@/components/app/safely";
import { FormNotice } from "@/components/app/FormNotice";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import type { FormState } from "@/app/(platform)/provider/actions";

export function Actions({ saveLabel = "Save changes", closeHref }: { saveLabel?: string; closeHref: string }) {
  const { pending } = useFormStatus();
  return (
    <div className="form-actions">
      <Link href={closeHref} className="button button--soft" style={{ display: "grid", placeItems: "center" }}>Close</Link>
      <button type="submit" className="button" disabled={pending} aria-busy={pending}>
        {pending ? "Saving…" : saveLabel}
      </button>
    </div>
  );
}

type Props = {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children: (state: FormState) => React.ReactNode;
  /** Read the answers back before sending. Off for a password change: there is nothing to read. */
  check?: boolean;
};

/** Shared wrapper so every settings form reports errors and success the same way. */
export function SoftForm({ action, children, check = true }: Props) {
  const [state, formAction] = useActionState(useSafely(action), {} as FormState);
  return (
    <form action={formAction} className="form-soft form-soft--page">
      {check ? <CheckFirst /> : null}
      {children(state)}
      {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
      <FormNotice state={state} />
    </form>
  );
}
