"use client";

import { useActionState } from "react";
import { useSafely } from "@/components/app/safely";
import { FormNotice } from "@/components/app/FormNotice";
import { Field } from "@/components/auth/Field";
import { PasswordField } from "@/components/auth/PasswordField";
import { OtpInput } from "@/components/auth/OtpInput";
import { ResendButton } from "@/components/auth/forms";
import { OTP_LENGTH_PUBLIC } from "@/lib/constants";
import type { FormState } from "@/lib/auth-flows";
import { Actions, SoftForm } from "./SoftForm";

type Action = (prev: FormState, fd: FormData) => Promise<FormState>;

/** Step one: the new address, and the current password to show it is really them. */
export function ChangeEmailForm({ action, closeHref, current }: { action: Action; closeHref: string; current: string }) {
  return (
    <SoftForm action={action} check={false}>
      {(s) => {
        const e = s.fieldErrors ?? {};
        const v = s.values ?? {};
        return (
          <>
            <div className="field">
              <label className="field__label" htmlFor="email-now">Current email address</label>
              <div className="field__box">
                <input id="email-now" className="field__input" value={current} readOnly aria-readonly="true" />
              </div>
            </div>
            <Field name="email" label="New email address" type="email" inputMode="email" placeholder="abc@gmail.com" autoComplete="email"
              defaultValue={v.email} error={e.email} helper="We will send a code to this address. Your email only changes once you enter it." />
            <PasswordField name="password" label="Current password" autoComplete="current-password" placeholder="Enter your current password" error={e.password} />
            <Actions saveLabel="Send code" closeHref={closeHref} />
          </>
        );
      }}
    </SoftForm>
  );
}

/** Step two: the code sent to the new address. */
export function ChangeEmailCodeForm({ action, resendAction, closeHref }: { action: Action; resendAction: Action; closeHref: string }) {
  const [state, formAction] = useActionState(useSafely(action), {} as FormState);
  const [resendState, resend] = useActionState(useSafely(resendAction), {} as FormState);
  return (
    <>
      <form action={formAction} className="form-soft form-soft--page">
        <OtpInput length={OTP_LENGTH_PUBLIC} label="OTP" error={state.fieldErrors?.code} attempt={state} />
        {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
        {resendState.error ? <p className="notice notice--error" role="alert">{resendState.error}</p> : null}
        <FormNotice state={resendState} />
        <Actions saveLabel="Verify" closeHref={closeHref} />
      </form>
      <form action={resend} className="resend">
        Didn’t get any code? <ResendButton sent={resendState} />
      </form>
    </>
  );
}
