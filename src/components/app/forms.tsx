"use client";

import { Field } from "@/components/auth/Field";
import { PasswordField } from "@/components/auth/PasswordField";
import { saveAccount, saveBusinessDetails, changePassword } from "@/app/provider/(app)/settings/actions";
import { Actions, SoftForm } from "./SoftForm";

const SETTINGS = "/provider/settings";

export function BusinessForm({ initial }: { initial: { name: string; phone: string; email: string; town: string; description: string } }) {
  return (
    <SoftForm action={saveBusinessDetails}>
      {(s) => {
        const e = s.fieldErrors ?? {};
        const v = s.values ?? {};
        const val = (k: keyof typeof initial) => v[k] ?? initial[k];
        return (
          <>
            <Field name="name" label="Business name" placeholder="Kandeh Farming Services" autoComplete="organization" defaultValue={val("name")} error={e.name} />
            <Field name="phone" label="Phone number" type="tel" inputMode="tel" prefix="+232" placeholder="00 000 000" autoComplete="tel-national" defaultValue={val("phone")} error={e.phone} />
            <Field name="email" label="Email address" type="email" inputMode="email" placeholder="abc@gmail.com" autoComplete="email" defaultValue={val("email")} error={e.email} />
            <Field name="town" label="Village/town" placeholder="Where your equipment is based" defaultValue={val("town")} error={e.town} />
            <div className={`field${e.description ? " field--invalid" : ""}`}>
              <label className="field__label" htmlFor="desc">Additional information</label>
              <div className="field__box" style={{ height: "auto", alignItems: "flex-start" }}>
                <textarea id="desc" name="description" className="field__input" rows={3} maxLength={500} defaultValue={val("description")}
                  placeholder="eg: we cover Bombali and Tonkolili, two tractors available" style={{ resize: "vertical" }} />
              </div>
              {e.description ? <p className="field__error">{e.description}</p> : null}
            </div>
            <Actions closeHref={SETTINGS} />
          </>
        );
      }}
    </SoftForm>
  );
}

export function AccountForm({ initial }: { initial: { name: string; phone: string; email: string } }) {
  return (
    <SoftForm action={saveAccount}>
      {(s) => {
        const e = s.fieldErrors ?? {};
        const v = s.values ?? {};
        return (
          <>
            <Field name="name" label="Full name" placeholder="Salieu Jalloh" autoComplete="name" defaultValue={v.name ?? initial.name} error={e.name} />
            <Field name="phone" label="Phone number" type="tel" inputMode="tel" prefix="+232" placeholder="00 000 000" autoComplete="tel-national" defaultValue={v.phone ?? initial.phone} error={e.phone} />
            <div className="field">
              <label className="field__label" htmlFor="acc-email">Email address</label>
              <div className="field__box">
                <input id="acc-email" className="field__input" value={initial.email} readOnly aria-readonly="true" />
              </div>
              <p className="field__helper">Changing your sign-in email needs a new verification code. That screen isn&apos;t designed yet.</p>
            </div>
            <Actions closeHref={SETTINGS} />
          </>
        );
      }}
    </SoftForm>
  );
}

export function PasswordForm() {
  return (
    <SoftForm action={changePassword}>
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
