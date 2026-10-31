"use client";

import type { ComponentProps } from "react";
import { useFormStatus } from "react-dom";

/**
 * A submit button that shows it was pressed and cannot be pressed twice. Without JavaScript it is
 * a plain submit button. `confirm` asks first, for actions that are hard to undo.
 */
export function PendingButton({ confirm, onClick, disabled, children, ...rest }: ComponentProps<"button"> & { confirm?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      {...rest}
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
        else onClick?.(e);
      }}
    >
      {children}
    </button>
  );
}
