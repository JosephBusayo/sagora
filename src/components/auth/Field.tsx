"use client";

import { useEffect, useId, useRef, useState } from "react";
import { focusFirstError } from "./focus-first-error";

type Props = {
  name: string;
  label: string;
  type?: "text" | "email" | "tel";
  placeholder?: string;
  autoComplete?: string;
  inputMode?: "text" | "email" | "tel" | "numeric";
  defaultValue?: string;
  required?: boolean;
  error?: string;
  helper?: string;
  /** Fixed text shown inside the box before the input, e.g. the +232 country code. */
  prefix?: string;
  maxLength?: number;
};

export function Field({
  name,
  label,
  type = "text",
  placeholder,
  autoComplete,
  inputMode,
  defaultValue,
  required = true,
  error,
  helper,
  prefix,
  maxLength,
}: Props) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  // Checked when someone leaves the field, so nobody is told off while still typing.
  const [local, setLocal] = useState("");
  const shown = error || local;
  const describedBy = shown ? `${id}-err` : helper ? `${id}-help` : undefined;
  useEffect(() => {
    if (error) focusFirstError(input.current?.form);
  }, [error]);

  function check(el: HTMLInputElement) {
    if (el.validity.valueMissing) setLocal(`Enter ${label.toLowerCase()}`);
    else if (el.validity.typeMismatch && type === "email") setLocal("Enter a valid email address");
    else setLocal("");
  }

  return (
    <div className={`field${shown ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={id}>
        {label}
        {!required && !/optional/i.test(label) ? " (optional)" : null}
      </label>
      <div className="field__box">
        {prefix ? <span className="field__prefix">{prefix}</span> : null}
        <input
          ref={input}
          id={id}
          className="field__input"
          name={name}
          type={type}
          placeholder={placeholder}
          autoComplete={autoComplete}
          inputMode={inputMode}
          defaultValue={defaultValue}
          required={required}
          maxLength={maxLength}
          aria-invalid={shown ? true : undefined}
          aria-describedby={describedBy}
          onBlur={(e) => check(e.currentTarget)}
          onInput={() => setLocal("")}
        />
      </div>
      {shown ? (
        <p className="field__error" id={`${id}-err`}>
          {shown}
        </p>
      ) : helper ? (
        <p className="field__helper" id={`${id}-help`}>
          {helper}
        </p>
      ) : null}
    </div>
  );
}
