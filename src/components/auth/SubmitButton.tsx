"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ children, pendingLabel }: { children: React.ReactNode; pendingLabel?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="button" disabled={pending} aria-busy={pending}>
      {pending ? (pendingLabel ?? "Please wait…") : children}
    </button>
  );
}
