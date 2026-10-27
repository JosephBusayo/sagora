"use client";

import { useId, useState } from "react";

type Props = {
  name: string;
  label: string;
  autoComplete: "new-password" | "current-password";
  placeholder?: string;
  error?: string;
  helper?: React.ReactNode;
};

function Eye({ off }: { off: boolean }) {
  // Solid eye, as in the design. The slash marks "hide".
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M12 5C6.6 5 2.7 9 1.5 11.3a1.5 1.5 0 0 0 0 1.4C2.7 15 6.6 19 12 19s9.3-4 10.5-6.3a1.5 1.5 0 0 0 0-1.4C21.3 9 17.4 5 12 5Z" />
      <circle cx="12" cy="12" r="3.1" fill="var(--color-surface)" />
      {off ? <path d="M4 4l16 16" stroke="var(--color-surface)" strokeWidth="4.5" strokeLinecap="round" /> : null}
      {off ? <path d="M4 4l16 16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /> : null}
    </svg>
  );
}

/** Password input with a show/hide toggle. Works as a normal password field without JavaScript. */
export function PasswordField({ name, label, autoComplete, placeholder = "Enter your password", error, helper }: Props) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const describedBy = error ? `${id}-err` : helper ? `${id}-help` : undefined;
  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="field__box">
        <input
          id={id}
          className="field__input"
          name={name}
          type={visible ? "text" : "password"}
          autoComplete={autoComplete}
          placeholder={placeholder}
          required
          minLength={8}
          maxLength={128}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
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
      {error ? (
        <p className="field__error" id={`${id}-err`}>
          {error}
        </p>
      ) : helper ? (
        <p className="field__helper" id={`${id}-help`}>
          {helper}
        </p>
      ) : null}
    </div>
  );
}
