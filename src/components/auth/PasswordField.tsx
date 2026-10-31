"use client";

import { useEffect, useId, useRef, useState } from "react";
import { IconEyeOpen, IconEyeSlash } from "@central-icons-react/round-filled-radius-2-stroke-2";
import { focusFirstError } from "./focus-first-error";

type Props = {
  name: string;
  label: string;
  autoComplete: "new-password" | "current-password";
  placeholder?: string;
  error?: string;
  helper?: React.ReactNode;
};

function Eye({ off }: { off: boolean }) {
  // Central Icon System, same set as the rest of the app. The slash marks "hide".
  const C = off ? IconEyeSlash : IconEyeOpen;
  return <C size={20} aria-hidden />;
}

/** Password input with a show/hide toggle. Works as a normal password field without JavaScript. */
export function PasswordField({ name, label, autoComplete, placeholder = "Enter your password", error, helper }: Props) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const [mismatch, setMismatch] = useState(false);
  const [long, setLong] = useState(false);
  const fresh = autoComplete === "new-password";
  const shown = error ?? (mismatch ? "Passwords do not match" : undefined);
  useEffect(() => {
    if (error) focusFirstError(input.current?.form);
  }, [error]);
  const describedBy = shown ? `${id}-err` : helper ? `${id}-help` : undefined;

  function compare(el: HTMLInputElement) {
    const other = el.form?.querySelector<HTMLInputElement>('input[name="password"]');
    setMismatch(name === "confirm" && el.value !== "" && el.value !== other?.value);
  }

  return (
    <div className={`field${shown ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="field__box">
        <input
          ref={input}
          id={id}
          className="field__input"
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required
          minLength={8}
          maxLength={128}
          aria-invalid={shown ? true : undefined}
          aria-describedby={describedBy}
          onInput={(e) => {
            setLong(e.currentTarget.value.length >= 8);
            setMismatch(false);
          }}
          onBlur={(e) => compare(e.currentTarget)}
        />
        <button
          type="button"
          className="field__toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide password" : "Show password"}
          aria-pressed={visible}
        >
          <Eye off={visible} />
        </button>
      </div>
      {shown ? (
        <p className="field__error" id={`${id}-err`}>
          {shown}
        </p>
      ) : helper ? (
        <p className={`field__helper${fresh && long ? " field__helper--ok" : ""}`} id={`${id}-help`}>
          {helper}
        </p>
      ) : null}
    </div>
  );
}
