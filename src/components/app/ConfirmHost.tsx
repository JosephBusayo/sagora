"use client";

import { useEffect, useRef, useState } from "react";
import type { ConfirmRequest } from "./confirm";

/** One confirmation dialog for the whole site. A native dialog keeps focus and handles Escape. */
export function ConfirmHost() {
  const [ask, setAsk] = useState<ConfirmRequest | null>(null);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const onAsk = (e: Event) => setAsk((e as CustomEvent<ConfirmRequest>).detail);
    window.addEventListener("sagora:confirm", onAsk);
    return () => window.removeEventListener("sagora:confirm", onAsk);
  }, []);

  useEffect(() => {
    if (ask) ref.current?.showModal();
  }, [ask]);

  const answer = (yes: boolean) => {
    ref.current?.close();
    ask?.resolve(yes);
    setAsk(null);
  };

  return (
    <dialog ref={ref} className="confirm" aria-label="Confirm" onCancel={(e) => { e.preventDefault(); answer(false); }}>
      {ask ? (
        <>
          <h2 className="confirm__title">{ask.title}</h2>
          {ask.body ? <p className="confirm__body">{ask.body}</p> : null}
          <div className="request-card__actions">
            <button type="button" className="button button--soft" onClick={() => answer(false)}>Go back</button>
            <button type="button" className="button" onClick={() => answer(true)}>{ask.action}</button>
          </div>
        </>
      ) : null}
    </dialog>
  );
}
