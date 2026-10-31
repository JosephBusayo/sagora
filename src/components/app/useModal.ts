"use client";

import { useCallback, useEffect, useRef, type RefObject } from "react";
import { askToConfirm } from "./confirm";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled])';

/**
 * What every dialog needs: focus moves in and stays in, returns afterwards, the page behind stays
 * still, and Escape or a click outside closes it, asking first if something has been typed.
 * Returns that guarded close. A Cancel button keeps using onClose: it is already a decision.
 */
export function useModal(ref: RefObject<HTMLElement | null>, onClose: () => void) {
  const dirty = useRef(false);
  const latest = useRef(onClose);
  useEffect(() => {
    latest.current = onClose;
  });

  const close = useCallback(() => {
    if (!dirty.current) {
      latest.current();
      return;
    }
    void askToConfirm("Close without saving?", "Close and lose changes", "What you have entered will be lost.").then((yes) => {
      if (yes) latest.current();
    });
  }, []);

  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    const before = document.activeElement as HTMLElement | null;
    const scroll = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    (box.querySelector<HTMLElement>("input:not([type='hidden']), select, textarea") ?? box.querySelector<HTMLElement>(FOCUSABLE))?.focus();

    const onInput = () => { dirty.current = true; };
    const onKey = (e: KeyboardEvent) => {
      // A confirmation on top of this dialog deals with its own keys.
      if (document.querySelector("dialog[open]")) return;
      if (e.key === "Escape") {
        close();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null);
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    const onLeave = (e: BeforeUnloadEvent) => { if (dirty.current) e.preventDefault(); };

    box.addEventListener("input", onInput);
    document.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      box.removeEventListener("input", onInput);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onLeave);
      document.body.style.overflow = scroll;
      before?.focus?.();
    };
  }, [ref, close]);

  return close;
}
