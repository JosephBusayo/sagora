import { useId } from "react";

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
  const describedBy = error ? `${id}-err` : helper ? `${id}-help` : undefined;
  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <div className="field__box">
        {prefix ? <span className="field__prefix">{prefix}</span> : null}
        <input
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
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
        />
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
