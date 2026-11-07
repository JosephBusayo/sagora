"use client";

import Link from "next/link";
import { useState } from "react";
import { Field } from "@/components/auth/Field";
import { SoftForm } from "@/components/app/SoftForm";
import { Icon } from "@/components/app/Icon";
import { useFormStatus } from "react-dom";
import { saveDestination } from "@/app/(platform)/provider/(app)/payments/actions";

export type DestinationInitial = { method: string; accountName: string; accountRef: string; bank: string };

/** Banks a payout can be sent to. A bank saved earlier that is not listed stays selectable. */
export const BANKS = [
  "Access Bank", "Ecobank", "First Bank", "Guaranty Trust Bank", "Keystone Bank", "Rokel Commercial Bank",
  "Sierra Leone Commercial Bank", "Standard Chartered Bank", "United Bank for Africa", "Union Trust Bank", "Vista Bank", "Zenith Bank",
];

/** The design calls a mobile money payout a Monime account; the stored method stays mobile_money. */
const METHODS = [
  { id: "bank", label: "Bank account", body: "Receive payouts directly to your bank", icon: "store" as const },
  { id: "mobile_money", label: "Monime", body: "Receive payouts to your Monime account", icon: "payments" as const },
];

function Save() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="button" disabled={pending} aria-busy={pending} formNoValidate>
      {pending ? "Saving…" : "Save payout account"}
    </button>
  );
}

/**
 * Where a provider's money is sent, in the design's steps: pick Bank account or Monime, then fill
 * in that account. Payouts are still sent by the Sagora team, so nothing here talks to a bank.
 */
export function DestinationForm({ initial, cancelHref, changing }: { initial: DestinationInitial; cancelHref: string; changing: boolean }) {
  const [method, setMethod] = useState(initial.method || "");
  const [step, setStep] = useState<"choose" | "details">("choose");
  const [missing, setMissing] = useState(false);
  const banks = initial.bank && !BANKS.includes(initial.bank) ? [...BANKS, initial.bank] : BANKS;

  if (step === "choose") {
    return (
      <div className="payout-setup">
        <header className="modal__head modal__head--center">
          <h2>Add payment method</h2>
          <p>Choose how you want to receive your payouts.</p>
        </header>
        <fieldset className="method-pick">
          <legend className="sr-only">Payment method</legend>
          {METHODS.map((m) => (
            <label key={m.id} className="method-pick__card">
              <span className="method-pick__icon" aria-hidden="true"><Icon name={m.icon} size={24} /></span>
              <span className="method-pick__text">
                <span className="method-pick__title">{m.label}</span>
                <span className="method-pick__body">{m.body}</span>
              </span>
              <input type="radio" name="method-choice" value={m.id} checked={method === m.id}
                onChange={() => { setMethod(m.id); setMissing(false); }} />
              <span className="chip__icon" aria-hidden="true" />
            </label>
          ))}
        </fieldset>
        {missing ? <p className="notice notice--error" role="alert">Choose how you want to receive your payouts</p> : null}
        <div className="form-actions">
          <Link href={cancelHref} className="button button--soft">Cancel</Link>
          <button type="button" className="button" onClick={() => (method ? setStep("details") : setMissing(true))}>Continue</button>
        </div>
      </div>
    );
  }

  const bank = method === "bank";
  return (
    <div className="payout-setup">
      <header className="modal__head modal__head--center">
        <h2>{bank ? "Add payment method" : "Add Monime account"}</h2>
        <p>{bank ? "Choose how you want to receive your payouts." : "Enter your Monime account details"}</p>
      </header>
      <SoftForm action={saveDestination}>
        {(s) => {
          const e = s.fieldErrors ?? {};
          const v = s.values ?? {};
          return (
            <>
              <input type="hidden" name="method" value={method} />
              {bank ? (
                <>
                  <div className={`field${e.bank ? " field--invalid" : ""}`}>
                    <label className="field__label" htmlFor="payout-bank">Bank name</label>
                    <div className="field__box">
                      <select id="payout-bank" name="bank" className="field__input" defaultValue={v.bank ?? initial.bank}>
                        <option value="">Select a bank</option>
                        {banks.map((b) => <option key={b} value={b}>{b}</option>)}
                      </select>
                    </div>
                    {e.bank ? <p className="field__error">{e.bank}</p> : null}
                  </div>
                  <Field name="accountRef" label="Account number" placeholder="0000 1234 5678" inputMode="numeric"
                    defaultValue={v.accountRef ?? (initial.method === "bank" ? initial.accountRef : "")} error={e.accountRef} />
                </>
              ) : (
                <Field name="accountRef" label="Monime phone number" type="tel" inputMode="tel" prefix="+232" placeholder="00 000 000"
                  defaultValue={v.accountRef ?? (initial.method === "mobile_money" ? initial.accountRef : "")} error={e.accountRef} />
              )}
              <Field name="accountName" label="Account name" defaultValue={v.accountName ?? initial.accountName} error={e.accountName} />
              {changing ? <p className="field__helper">Changing this sends any payout waiting to be paid back for approval.</p> : null}
              <div className="form-actions">
                <button type="button" className="button button--soft" onClick={() => setStep("choose")}>Back</button>
                <Save />
              </div>
            </>
          );
        }}
      </SoftForm>
    </div>
  );
}
