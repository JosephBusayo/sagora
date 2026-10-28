"use client";

import { useEffect } from "react";

/** Submits the filter form when a dropdown changes. Without JavaScript the Apply button does it. */
export function FilterAutoSubmit() {
  useEffect(() => {
    const form = document.querySelector<HTMLFormElement>("form.filters");
    if (!form) return;
    const onChange = () => form.requestSubmit();
    form.addEventListener("change", onChange);
    return () => form.removeEventListener("change", onChange);
  }, []);
  return null;
}
