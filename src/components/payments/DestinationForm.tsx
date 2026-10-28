"use client";

import { useState } from "react";
import { Field } from "@/components/auth/Field";
import { SoftForm } from "@/components/app/SoftForm";
import { useFormStatus } from "react-dom";
import { saveDestination } from "@/app/provider/(app)/payments/actions";

export type DestinationInitial = { method: string; accountName: string; accountRef: string; bank: string };

const METHODS = [
  { id: "mobile_money", label: "Mobile money" },
  { id: "bank", label: "Bank account" },
];

function Save() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="button" disabled={pending} aria-busy={pending} formNoValidate>
      {pending ? "Saving…" : "Save where money goes"}
    </button>
  );
}

/**
 * Where a provider's money is sent. This is the part of the design's "payment method" step that
 * does not depend on a payment provider, so it works today and keeps working once one is added.
 */
export function DestinationForm({ initial }: { initial: DestinationInitial }) {
  const [method, setMethod] = useState(initial.method || "mobile_money");

  return (
    <SoftForm action={saveDestination}>
      {(s) => {
        const e = s.fieldErrors ?? {};
        const v = s.values ?? {};
        return (
          <>
            <div className="field">
              <label className="field__label" htmlFor="payout-method">How you want to be paid</label>
              <div className="field__box">
                <select
                  id="payout-method" name="method" className="field__input"
                  value={method} onChange={(ev) => setMethod(ev.target.value)}
                >
                  {METHODS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                </select>
              </div>
            </div>

            <Field
              name="accountName" label="Name on the account" placeholder="Kandeh Farming Services"
              defaultValue={v.accountName ?? initial.accountName} error={e.accountName}
            />

            {method === "bank" ? (
              <Field
                name="bank" label="Bank" placeholder="Rokel Commercial Bank"
                defaultValue={v.bank ?? initial.bank} error={e.bank}
              />
            ) : null}

            <Field
              name="accountRef"
              label={method === "mobile_money" ? "Mobile money number" : "Account number"}
              type={method === "mobile_money" ? "tel" : "text"}
              inputMode={method === "mobile_money" ? "tel" : "numeric"}
              prefix={method === "mobile_money" ? "+232" : undefined}
              placeholder={method === "mobile_money" ? "00 000 000" : "0012345678"}
              defaultValue={v.accountRef ?? initial.accountRef}
              error={e.accountRef}
              helper="Changing this sends any payout waiting to be paid back for approval."
            />

            <Save />
          </>
        );
      }}
    </SoftForm>
  );
}
