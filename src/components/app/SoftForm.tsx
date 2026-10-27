"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import Link from "next/link";
import type { FormState } from "@/app/provider/actions";

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
};

/** Shared wrapper so every settings form reports errors and success the same way. */
export function SoftForm({ action, children }: Props) {
  const [state, formAction] = useActionState(action, {} as FormState);
  return (
    <form action={formAction} className="form-soft">
      {children(state)}
      {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
      {state.notice ? <p className="notice notice--success" role="status">{state.notice}</p> : null}
    </form>
  );
}
