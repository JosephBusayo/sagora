"use client";

import { useActionState } from "react";
import { Field } from "@/components/auth/Field";
import { PasswordField } from "@/components/auth/PasswordField";
import { SubmitButton } from "@/components/auth/SubmitButton";
import { acceptInviteAction } from "@/app/provider/join/actions";
import type { FormState } from "@/app/provider/actions";

export function JoinForm({ token, name }: { token: string; name: string }) {
  const [state, action] = useActionState(acceptInviteAction, {} as FormState);
  const e = state.fieldErrors ?? {};
  return (
    <form action={action} className="auth__form">
      <input type="hidden" name="token" value={token} />
      <Field name="name" label="Your name" placeholder="Salieu Jalloh" autoComplete="name" defaultValue={state.values?.name ?? name} error={e.name} />
      <PasswordField name="password" label="Password" autoComplete="new-password" placeholder="Create a password" helper="At least 8 characters" error={e.password} />
      <PasswordField name="confirm" label="Confirm Password" autoComplete="new-password" placeholder="Repeat your password" error={e.confirm} />
      <div className="auth__actions">
        {state.error ? <p className="notice notice--error" role="alert">{state.error}</p> : null}
        <SubmitButton pendingLabel="Joining…">Join the team</SubmitButton>
      </div>
    </form>
  );
}
