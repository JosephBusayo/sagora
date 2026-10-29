"use client";

import { Field } from "@/components/auth/Field";
import { PasswordField } from "@/components/auth/PasswordField";
import { saveFarmerAccount, changeFarmerPassword } from "@/app/farmer/settings/actions";
import { Actions, SoftForm } from "./SoftForm";

const SETTINGS = "/farmer/settings";

export function FarmerAccountForm({ initial }: { initial: { name: string; phone: string; email: string } }) {
  return (
    <SoftForm action={saveFarmerAccount}>
      {(s) => {
        const e = s.fieldErrors ?? {};
        const v = s.values ?? {};
        return (
          <>
            <Field
              name="name" label="First and last name" placeholder="Aminata Kamara" autoComplete="name"
              defaultValue={v.name ?? initial.name} error={e.name}
            />
            <Field
              name="phone" label="Phone number" type="tel" inputMode="tel" prefix="+232" placeholder="00 000 000"
              autoComplete="tel-national" defaultValue={v.phone ?? initial.phone} error={e.phone}
            />
            <div className="field">
              <label className="field__label" htmlFor="farmer-email">Email address</label>
              <div className="field__box">
                <input id="farmer-email" className="field__input" value={initial.email} readOnly aria-readonly="true" />
              </div>
              <p className="field__helper">
                This is how you sign in. Changing it needs a new verification code, which isn&apos;t built yet.
              </p>
            </div>
            <Actions closeHref={SETTINGS} />
          </>
        );
      }}
    </SoftForm>
  );
}

export function FarmerPasswordForm() {
  return (
    <SoftForm action={changeFarmerPassword}>
      {(s) => {
        const e = s.fieldErrors ?? {};
        return (
          <>
            <PasswordField name="current" label="Current password" autoComplete="current-password" placeholder="Enter your current password" error={e.current} />
            <PasswordField name="password" label="New password" autoComplete="new-password" placeholder="Create a new password" helper="At least 8 characters" error={e.password} />
            <PasswordField name="confirm" label="Confirm new password" autoComplete="new-password" placeholder="Repeat your new password" error={e.confirm} />
            <Actions saveLabel="Save new password" closeHref={SETTINGS} />
          </>
        );
      }}
    </SoftForm>
  );
}
