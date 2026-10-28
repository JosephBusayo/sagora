"use client";

import { useId, useState } from "react";
import { IconEyeOpen, IconEyeSlash } from "@central-icons-react/round-filled-radius-2-stroke-2";

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
