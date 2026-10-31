"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

type Props = {
  length: number;
  label: string;
  error?: string;
  /** Shown under the boxes, e.g. the resend link. */
  footer?: React.ReactNode;
  /** A new value means the server answered, so the boxes clear for another try. */
  attempt?: unknown;
};

/**
 * Seven-box one-time code input (matches the design).
 * The boxes feed one hidden field named "code". With JavaScript off, the boxes are
 * hidden and a plain text field named "codeFallback" is shown instead.
 */
export function OtpInput({ length, label, error, footer, attempt }: Props) {
  const [digits, setDigits] = useState<string[]>(() => Array(length).fill(""));
  const refs = useRef<Array<HTMLInputElement | null>>([]);
  const { pending } = useFormStatus();
  const sent = useRef("");
  const code = digits.join("");

  // The last digit submits by itself. Remembering the code stops the same one going twice.
  useEffect(() => {
    if (code.length === length && !digits.includes("") && code !== sent.current && !pending) {
      sent.current = code;
      refs.current[0]?.form?.requestSubmit();
    }
  }, [code, digits, length, pending]);

  // A refused code clears, ready for the next try.
  const [answered, setAnswered] = useState(attempt);
  if (answered !== attempt) {
    setAnswered(attempt);
    if (error) setDigits(Array(length).fill(""));
  }
  useEffect(() => {
    if (!error) return;
    sent.current = "";
    refs.current[0]?.focus();
  }, [attempt, error]);

  function set(index: number, value: string) {
    setDigits((prev) => {
      const next = [...prev];
      next[index] = value;
      return next;
    });
  }

  function fill(index: number, chars: string[]) {
    setDigits((prev) => {
      const next = [...prev];
      chars.forEach((c, i) => (next[index + i] = c));
      return next;
    });
    refs.current[Math.min(index + chars.length, length - 1)]?.focus();
  }

  function onChange(index: number, raw: string) {
    let clean = raw.replace(/\D/g, "");
    if (!clean) {
      set(index, "");
      return;
    }
    // Typing into a box that already holds a digit adds a second character: keep the new one.
    const old = digits[index];
    if (old && clean.length === 2) clean = clean[0] === old ? clean[1] : clean[0];
    // Several digits at once (autofill from the email, or a paste) fill the following boxes.
    fill(index, clean.slice(0, length - index).split(""));
  }

  function onPaste(index: number, e: React.ClipboardEvent<HTMLInputElement>) {
    const text = e.clipboardData.getData("text").replace(/\D/g, "");
    if (!text) return;
    e.preventDefault();
    fill(index, text.slice(0, length - index).split(""));
  }

  function onKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    // A typed digit always lands in this box and moves on, even when it equals the old one
    // (the browser would not report a change in that case).
    if (/^\d$/.test(e.key) && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      fill(index, [e.key]);
      return;
    }
    if (e.key === "Backspace" && !digits[index] && index > 0) {
      refs.current[index - 1]?.focus();
    } else if (e.key === "ArrowLeft" && index > 0) {
      refs.current[index - 1]?.focus();
    } else if (e.key === "ArrowRight" && index < length - 1) {
      refs.current[index + 1]?.focus();
    }
  }

  return (
    <div className={`field${error ? " field--invalid" : ""}`}>
      <span className="field__label" id="otp-label">
        {label}
      </span>
      <noscript>
        <style>{".otp__boxes{display:none}"}</style>
        <input className="otp__fallback" name="codeFallback" inputMode="numeric" autoComplete="one-time-code" maxLength={length} aria-label={label} placeholder={"0".repeat(length)} />
      </noscript>
      <div className={`otp otp__boxes${error ? " otp--invalid" : ""}`} role="group" aria-labelledby="otp-label">
        {digits.map((d, i) => (
          <input
            key={i}
            ref={(el) => {
              refs.current[i] = el;
            }}
            className="otp__box"
            inputMode="numeric"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            pattern="[0-9]*"
            maxLength={length}
            value={d}
            readOnly={pending}
            onChange={(e) => onChange(i, e.target.value)}
            onKeyDown={(e) => onKeyDown(i, e)}
            onPaste={(e) => onPaste(i, e)}
            onFocus={(e) => e.target.select()}
            aria-label={`Digit ${i + 1} of ${length}`}
          />
        ))}
      </div>
      <input type="hidden" name="code" value={digits.join("")} />
      {error ? <p className="field__error">{error}</p> : null}
      {footer}
    </div>
  );
}
