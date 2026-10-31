"use client";

import { useSafely } from "@/components/app/safely";
import { useActionState } from "react";
import { Field } from "@/components/auth/Field";
import { PasswordField } from "@/components/auth/PasswordField";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { acceptStaffInviteAction } from "@/app/staff/join/actions";
import type { FormState } from "@/lib/auth-flows";

export function StaffJoinForm({ token, name }: { token: string; name: string }) {
  const [state, action] = useActionState(useSafely(acceptStaffInviteAction), {} as FormState);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="auth__form">
      <input type="hidden" name="token" value={token} />
      <Field name="name" label="Your name" autoComplete="name" defaultValue={state.values?.name ?? name} error={e.name} />
      <PasswordField name="password" label="Password" autoComplete="new-password" placeholder="Create a password" helper="At least 8 characters" error={e.password} />
      <PasswordField name="confirm" label="Confirm Password" autoComplete="new-password" placeholder="Repeat your password" error={e.confirm} />
      <div className="auth__actions">
        {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
        <SubmitButton pendingLabel="Setting up…">Finish setup</SubmitButton>
      </div>
    </form>
  );
}
