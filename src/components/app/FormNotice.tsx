"use client";

import { useEffect } from "react";
import { showToast } from "./toast";

/** A form's success message: a toast, or a plain line with JavaScript off. */
export function FormNotice({ state }: { state: { notice?: string } }) {
  useEffect(() => {
    if (state.notice) showToast(state.notice);
  }, [state]);
  return state.notice ? <noscript><p className="notice notice--success" role="status">{state.notice}</p></noscript> : null;
}
