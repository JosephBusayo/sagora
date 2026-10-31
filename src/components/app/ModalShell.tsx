"use client";

import { useRef } from "react";
import { useRouter } from "next/navigation";
import { useModal } from "./useModal";

/** A dialog drawn by the server, so it opens with JavaScript off. Closing goes to `closeHref`. */
export function ModalShell({ closeHref, label, className = "", children }: { closeHref: string; label: string; className?: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const close = useModal(ref, () => router.push(closeHref));
  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className={`modal ${className}`} role="dialog" aria-modal="true" aria-label={label} ref={ref}>{children}</div>
    </div>
  );
}
