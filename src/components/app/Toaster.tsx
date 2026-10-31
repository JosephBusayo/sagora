"use client";

import { useEffect, useState } from "react";
import type { ToastKind } from "./toast";

type Toast = { id: number; message: string; kind: ToastKind };

const LIFE_MS = 5000;

function readFlash(): { message: string; kind: ToastKind } | null {
  const raw = document.cookie.split("; ").find((c) => c.startsWith("sagora_flash="));
  if (!raw) return null;
  document.cookie = "sagora_flash=; path=/; max-age=0";
  try {
    return JSON.parse(decodeURIComponent(raw.slice("sagora_flash=".length)));
  } catch {
    return null;
  }
}

/** Passing feedback, in the design's card style. Errors that need fixing stay beside their form. */
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => {
    const add = (message: string, kind: ToastKind) => {
      const id = Date.now() + Math.random();
      // The same message twice in a row is one message.
      setToasts((list) => (list.some((t) => t.message === message) ? list : [...list, { id, message, kind }]));
      setTimeout(() => setToasts((list) => list.filter((t) => t.id !== id)), LIFE_MS);
    };
    const onToast = (e: Event) => {
      const { message, kind } = (e as CustomEvent<{ message: string; kind: ToastKind }>).detail;
      add(message, kind);
    };
    window.addEventListener("sagora:toast", onToast);
    // A server action can answer with a redirect or a refresh, so there is no moment to hook.
    const poll = setInterval(() => {
      const f = readFlash();
      if (f) add(f.message, f.kind);
    }, 300);
    return () => {
      window.removeEventListener("sagora:toast", onToast);
      clearInterval(poll);
    };
  }, []);

  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast--${t.kind}`} role={t.kind === "error" ? "alert" : "status"}>
          <span className="toast__icon" aria-hidden="true" />
          <span className="toast__text">{t.message}</span>
          <button type="button" className="toast__close" aria-label="Dismiss" onClick={() => setToasts((list) => list.filter((x) => x.id !== t.id))}>×</button>
        </div>
      ))}
    </div>
  );
}
