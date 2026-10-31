"use client";

import { useRef, type ComponentProps } from "react";
import { useFormStatus } from "react-dom";
import { askToConfirm } from "./confirm";

type Props = ComponentProps<"button"> & {
  /** Asks first, for actions that are hard to undo. Skipped with JavaScript off. */
  confirm?: string;
  /** What the confirming button says. Always the action itself, never "Yes". */
  confirmAction?: string;
  confirmBody?: string;
};

/** A submit button that shows it was pressed and cannot be pressed twice. */
export function PendingButton({ confirm, confirmAction, confirmBody, onClick, disabled, children, ...rest }: Props) {
  const { pending } = useFormStatus();
  const agreed = useRef(false);
  return (
    <button
      {...rest}
      type="submit"
      disabled={disabled || pending}
      aria-busy={pending}
      onClick={(e) => {
        if (confirm && !agreed.current) {
          e.preventDefault();
          const button = e.currentTarget;
          void askToConfirm(confirm, confirmAction ?? "Continue", confirmBody).then((yes) => {
            if (!yes) return;
            agreed.current = true;
            button.click();
            agreed.current = false;
          });
          return;
        }
        onClick?.(e);
      }}
    >
      {children}
    </button>
  );
}
