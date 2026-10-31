"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

/** A thin bar while the next page loads, for screens that have no skeleton. */
export function PageProgress() {
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [seen, setSeen] = useState(pathname);
  if (seen !== pathname) {
    setSeen(pathname);
    setBusy(false);
  }

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) return;
      const link = (e.target as HTMLElement).closest?.("a");
      if (!link || link.target || link.origin !== location.origin || link.pathname === location.pathname) return;
      setBusy(true);
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  useEffect(() => {
    if (!busy) return;
    const stop = setTimeout(() => setBusy(false), 10000);
    return () => clearTimeout(stop);
  }, [busy]);

  return busy ? <div className="page-progress" aria-hidden="true" /> : null;
}
