"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Icon, ServiceIcon } from "./Icon";

type Option = { value: string; label: string };

/**
 * One of the design's rounded filter pills, opening the design's white menu. Until the page's
 * script runs it is a plain select, so a filter form still works with JavaScript off.
 *
 * Inside a GET form, choosing an option fills the hidden input and submits the form. Given
 * onChange instead, it only reports the choice (the equipment list filters on the page).
 */
export function FilterMenu({ name, label, value, icon, options, onChange }: {
  name: string; label: string; value?: string; icon: string; options: Option[]; onChange?: (value: string) => void;
}) {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [current, setCurrent] = useState(value ?? "");
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const hidden = useRef<HTMLInputElement>(null);
  useEffect(() => setReady(true), []); // eslint-disable-line react-hooks/set-state-in-effect

  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!root.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", away);
    return () => document.removeEventListener("mousedown", away);
  }, [open]);

  const chosen = options.find((o) => o.value === current) ?? options[0];
  const pick = (o: Option) => {
    setCurrent(o.value);
    setOpen(false);
    if (onChange) { onChange(o.value); return; }
    if (hidden.current) {
      hidden.current.value = o.value;
      hidden.current.form?.requestSubmit();
    }
  };

  if (!ready) {
    return (
      <label className={`filter${current ? " filter--on" : ""}`}>
        <img src={icon} alt="" width={18} height={18} />
        <span className="sr-only">{label}</span>
        <select name={onChange ? undefined : name} defaultValue={current} onChange={(e) => onChange?.(e.target.value)}>
          {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <span className="filter__chev" aria-hidden="true"><Icon name="chevron" size={12} /></span>
      </label>
    );
  }

  return (
    <div className={`filter filter--menu${current ? " filter--on" : ""}${open ? " filter--open" : ""}`} ref={root}>
      {onChange ? null : <input ref={hidden} type="hidden" name={name} defaultValue={current} />}
      <button
        type="button" className="filter__button" aria-haspopup="listbox" aria-expanded={open} aria-controls={id}
        aria-label={`${label}: ${chosen.label}`}
        onClick={() => { setActive(Math.max(0, options.indexOf(chosen))); setOpen(!open); }}
        onKeyDown={(e) => {
          if (!open && (e.key === "ArrowDown" || e.key === "ArrowUp")) { e.preventDefault(); setOpen(true); return; }
          if (!open) return;
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => (a + 1) % options.length); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => (a <= 0 ? options.length - 1 : a - 1)); }
          else if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pick(options[active]); }
          else if (e.key === "Escape") { e.preventDefault(); setOpen(false); }
        }}
      >
        <img src={icon} alt="" width={18} height={18} />
        <span>{chosen.label}</span>
        <span className="filter__chev" aria-hidden="true"><Icon name="chevron" size={12} /></span>
      </button>
      {open ? (
        <ul className="suggest filter__menu" id={id} role="listbox" aria-label={label}
          aria-activedescendant={`${id}-${active}`}>
          {options.map((o, i) => (
            <li key={o.value} id={`${id}-${i}`} role="option" aria-selected={o.value === current}>
              <button type="button" tabIndex={-1}
                className={`suggest__item${i === active ? " suggest__item--active" : ""}${o.value === current ? " suggest__item--current" : ""}`}
                onMouseEnter={() => setActive(i)} onClick={() => pick(o)}>
                {o.value === "ploughing" || o.value === "harvesting" || o.value === "planting" ? <ServiceIcon service={o.value} /> : null}
                <span className="suggest__text"><strong>{o.label}</strong></span>
                <Icon name="chevron" size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
