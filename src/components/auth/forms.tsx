"use client";

import Link from "next/link";
import { useActionState } from "react";
import {
  requestPasswordReset,
  resendCode,
  resetPassword,
  signInProvider,
  signUpProvider,
  verifyCode,
  type FormState,
} from "@/app/provider/actions";
import { OTP_LENGTH_PUBLIC } from "@/lib/constants";
import { Field } from "./Field";
import { OtpInput } from "./OtpInput";
import { PasswordField } from "./PasswordField";
import { SubmitButton } from "./SubmitButton";

const initial: FormState = {};

function Alert({ state }: { state: FormState }) {
  if (state.error) return <p className="notice notice--error" role="alert">{state.error}</p>;
  if (state.notice) return <p className="notice notice--success" role="status">{state.notice}</p>;
  return null;
}

export function SignUpForm() {
  const [state, action] = useActionState(signUpProvider, initial);
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="auth__form">
      <Field name="businessName" label="Business name" placeholder="Enter your business name" autoComplete="organization" defaultValue={v.businessName} error={e.businessName} />
      <Field name="phone" label="Your phone number" type="tel" inputMode="tel" prefix="+232" placeholder="00 000 000" autoComplete="tel-national" defaultValue={v.phone} error={e.phone} />
      <Field name="email" label="Email" type="email" inputMode="email" placeholder="abc@gmail.com" autoComplete="email" defaultValue={v.email} error={e.email} />
      <PasswordField name="password" label="Password" autoComplete="new-password" placeholder="Create a password" helper="At least 8 characters" error={e.password} />
      <div className="auth__actions">
        <Alert state={state} />
        <SubmitButton pendingLabel="Creating account…">Create account</SubmitButton>
      </div>
    </form>
  );
}

export function SignInForm() {
  const [state, action] = useActionState(signInProvider, initial);
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="auth__form">
      <Field name="email" label="Email" type="email" inputMode="email" placeholder="abc@gmail.com" autoComplete="email" defaultValue={v.email} error={e.email} />
      <PasswordField
        name="password"
        label="Password"
        autoComplete="current-password"
        error={e.password}
        helper={
          <>
            Forgot password? <Link href="/provider/forgot-password">Click here</Link>
          </>
        }
      />
      <div className="auth__actions">
        <Alert state={state} />
        <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
      </div>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, action] = useActionState(requestPasswordReset, initial);
  const e = state.fieldErrors ?? {};
  const v = state.values ?? {};
  return (
    <form action={action} className="auth__form">
      <Field name="email" label="Email" type="email" inputMode="email" placeholder="abc@gmail.com" autoComplete="email" defaultValue={v.email} error={e.email} />
      <div className="auth__actions">
        <Alert state={state} />
        <SubmitButton pendingLabel="Sending code…">Get verification code</SubmitButton>
      </div>
    </form>
  );
}

export function VerifyCodeForm() {
  const [state, action] = useActionState(verifyCode, initial);
  const [resendState, resendAction] = useActionState(resendCode, initial);
  const e = state.fieldErrors ?? {};
  return (
    <>
      {/* Separate form so "Resend code" can sit under the boxes, as in the design. */}
      <form id="resend-form" action={resendAction} />
      <form action={action} className="auth__form">
        <OtpInput
          length={OTP_LENGTH_PUBLIC}
          label="OTP"
          error={e.code}
          footer={
            <p className="resend">
              Didn’t get any code?{" "}
              <button type="submit" form="resend-form" formNoValidate className="resend__button">
                Resend code
              </button>
            </p>
          }
        />
        <div className="auth__actions">
          <Alert state={resendState} />
          <Alert state={state} />
          <SubmitButton pendingLabel="Checking…">Verify</SubmitButton>
        </div>
      </form>
    </>
  );
}

export function ResetPasswordForm() {
  const [state, action] = useActionState(resetPassword, initial);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="auth__form">
      {/* The design leaves 12px extra between the helper text and the second field. */}
      <div style={{ marginBottom: 12 }}>
        <PasswordField name="password" label="Password" autoComplete="new-password" placeholder="Create a new password" helper="At least 8 characters" error={e.password} />
      </div>
      <PasswordField name="confirm" label="Confirm Password" autoComplete="new-password" placeholder="Repeat your new password" error={e.confirm} />
      <div className="auth__actions">
        <Alert state={state} />
        <SubmitButton pendingLabel="Saving…">Reset password</SubmitButton>
      </div>
    </form>
  );
}
