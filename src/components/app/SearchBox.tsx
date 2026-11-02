"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Icon, ServiceIcon } from "./Icon";

export type Suggestion = { kind: "request" | "job" | "equipment"; service?: string; label: string; sub: string; href: string };

/**
 * The top bar's search, with suggestions under it as someone types. It is still a plain GET form
 * underneath, so Enter goes to the full results page, and it works with JavaScript off.
 */
export function SearchBox({ base, initial }: { base: string; initial?: string }) {
  const router = useRouter();
  const listId = useId();
  const [q, setQ] = useState(initial ?? "");
  const [items, setItems] = useState<Suggestion[]>([]);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLFormElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (!term) return;
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`${base}/search/suggest?q=${encodeURIComponent(term)}`, { signal: ctl.signal })
        .then((r) => (r.ok ? r.json() : []))
        .then((rows: Suggestion[]) => { setItems(rows); setActive(-1); })
        .catch(() => {});
    }, 150);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, base]);

  const shown = open && q.trim() !== "" ? items : [];
  const go = (s: Suggestion) => { setOpen(false); (document.activeElement as HTMLElement | null)?.blur(); router.push(s.href); };

  return (
    <form
      ref={wrap}
      className="topbar__search"
      action={`${base}/search`}
      role="search"
      onFocus={() => setOpen(true)}
      onBlur={(e) => { if (!wrap.current?.contains(e.relatedTarget as Node | null)) setOpen(false); }}
    >
      <img src="/icons/search.svg" alt="" width={18} height={18} />
      <input
        type="search" name="q" value={q} placeholder="Search requests, jobs, equipments..." aria-label="Search" maxLength={80} autoComplete="off"
        role="combobox" aria-expanded={shown.length > 0} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
        onChange={(e) => { setQ(e.target.value); if (!e.target.value.trim()) setItems([]); setOpen(true); }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && shown.length) { e.preventDefault(); setActive((a) => (a + 1) % shown.length); }
          else if (e.key === "ArrowUp" && shown.length) { e.preventDefault(); setActive((a) => (a <= 0 ? shown.length - 1 : a - 1)); }
          else if (e.key === "Enter" && active >= 0 && shown[active]) { e.preventDefault(); go(shown[active]); }
          else if (e.key === "Escape") { setOpen(false); e.currentTarget.blur(); }
        }}
      />
      {shown.length > 0 ? (
        <ul className="suggest" id={listId} role="listbox" aria-label="Suggestions">
          {shown.map((s, i) => (
            <li key={s.href + s.label} id={`${listId}-${i}`} role="option" aria-selected={i === active}>
              <a
                href={s.href} tabIndex={-1} className={`suggest__item${i === active ? " suggest__item--active" : ""}`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => { e.preventDefault(); go(s); }}
              >
                {s.kind === "equipment"
                  ? <span className="suggest__thumb" aria-hidden="true"><Icon name="equipment" size={22} /></span>
                  : <ServiceIcon service={s.service ?? ""} />}
                <span className="suggest__text"><strong>{s.label}</strong><span>{s.sub}</span></span>
                <Icon name="chevron" size={14} />
              </a>
            </li>
          ))}
        </ul>
      ) : null}
    </form>
  );
}
