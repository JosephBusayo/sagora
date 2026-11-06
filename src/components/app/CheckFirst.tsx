"use client";

import { useEffect, useRef, useState } from "react";

type Line = { label: string; value: string };

const text = (el: Element | null | undefined) => (el?.textContent ?? "").replace(/\s+/g, " ").trim();

/** The question a field answers: its own label, or, for a chip or tick box, its group's. */
function questionOf(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): string {
  const own = el.labels?.[0];
  if (own && !own.contains(el)) return text(own).replace(/\s*\(optional\)$/i, "");
  return text(el.closest("fieldset")?.querySelector("legend") ?? el.closest(".field")?.querySelector(".field__label")).replace(/\s*\(optional\)$/i, "");
}

/** What the person entered, as they would read it back: option names, not stored ids. */
function linesOf(form: HTMLFormElement): Line[] {
  const lines: Line[] = [];
  const seen = new Map<string, Line>();
  for (const el of Array.from(form.elements)) {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) continue;
    if (!el.name || el.disabled || el.closest("[data-check-skip]")) continue;
    if (el instanceof HTMLInputElement && ["hidden", "submit", "button", "file", "reset"].includes(el.type)) continue;

    let value = "";
    if (el instanceof HTMLSelectElement) value = el.value ? text(el.selectedOptions[0]) : "";
    else if (el instanceof HTMLInputElement && (el.type === "radio" || el.type === "checkbox")) {
      if (!el.checked) continue;
      value = text(el.labels?.[0]) || (el.type === "checkbox" ? "Yes" : el.value);
    } else if (el instanceof HTMLInputElement && el.type === "password") value = el.value ? "••••••••" : "";
    else if (el instanceof HTMLInputElement && el.type === "date" && el.value) {
      value = new Date(el.value + "T00:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
    } else value = el.value.trim();
    if (!value) continue;
    // A unit beside a number reads as one answer: "5 hectares", not two lines.
    if (el.hasAttribute("data-check-append")) {
      const last = lines[lines.length - 1];
      if (last) last.value += ` ${value.toLowerCase()}`;
      continue;
    }

    const label = questionOf(el) || el.name;
    // Several ticks under one question read as one line.
    const same = seen.get(label);
    if (same && el instanceof HTMLInputElement && el.type === "checkbox") {
      same.value += `, ${value}`;
      continue;
    }
    const line = { label, value };
    seen.set(label, line);
    lines.push(line);
  }
  return lines;
}

/**
 * Put inside a form: before it is sent, the person sees what they entered and confirms it, or goes
 * back to change it. Nothing is sent until they confirm. Left out of a form's earlier steps, so
 * only the final send asks.
 */
export function CheckFirst({ title = "Check before sending", action = "Confirm and send" }: { title?: string; action?: string }) {
  const marker = useRef<HTMLSpanElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const confirmed = useRef(false);
  const [pending, setPending] = useState<{ lines: Line[]; submitter: HTMLElement | null } | null>(null);

  useEffect(() => {
    const form = marker.current?.closest("form");
    if (!form) return;
    // Capture, so this runs before React's own handler sends the form.
    const onSubmit = (e: SubmitEvent) => {
      if (confirmed.current) {
        confirmed.current = false;
        return;
      }
      if (e.submitter?.hasAttribute("data-check-skip")) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      setPending({ lines: linesOf(form), submitter: e.submitter });
    };
    form.addEventListener("submit", onSubmit, true);
    return () => form.removeEventListener("submit", onSubmit, true);
  }, []);

  useEffect(() => {
    if (pending) dialog.current?.showModal();
  }, [pending]);

  const back = () => {
    dialog.current?.close();
    setPending(null);
  };
  const send = () => {
    const form = marker.current?.closest("form");
    const submitter = pending?.submitter;
    back();
    confirmed.current = true;
    form?.requestSubmit(submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement ? submitter : undefined);
  };

  return (
    <span ref={marker} data-check-skip>
      <dialog ref={dialog} className="confirm check-first" aria-label={title} onCancel={(e) => { e.preventDefault(); back(); }}>
        {pending ? (
          <>
            <h2 className="confirm__title">{title}</h2>
            <p className="confirm__body">Make sure everything is right. Nothing is sent until you confirm.</p>
            <div className="detail-list check-first__list">
              {pending.lines.map((l) => (
                <div key={l.label} className="detail-row">
                  <span className="detail-row__label">{l.label}</span>
                  <span className="detail-row__value">{l.value}</span>
                </div>
              ))}
            </div>
            <div className="request-card__actions">
              <button type="button" className="button button--soft" onClick={back}>Edit</button>
              <button type="button" className="button" onClick={send}>{action}</button>
            </div>
          </>
        ) : null}
      </dialog>
    </span>
  );
}
