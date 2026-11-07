"use client";

import { useActionState } from "react";
import { useSafely } from "@/components/app/safely";
import { Field } from "@/components/auth/Field";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { findRequestAction } from "@/app/(platform)/request/actions";
import type { FormState } from "@/lib/auth-flows";

export function FindRequestForm() {
  const [state, action] = useActionState(useSafely(findRequestAction), {} as FormState);
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="auth__form" noValidate>
      <Field name="code" label="Tracking code" placeholder="SAG-8KM32" autoComplete="off" maxLength={12} defaultValue={v.code} error={e.code} />
      <Field name="phone" label="Your phone number" type="tel" inputMode="tel" prefix="+232" placeholder="00 000 000" autoComplete="tel-national" defaultValue={v.phone} error={e.phone} />
      <div className="auth__actions">
        {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
        <SubmitButton pendingLabel="Finding…">Find my request</SubmitButton>
      </div>
    </form>
  );
}
