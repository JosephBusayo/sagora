"use client";

import { useSyncExternalStore } from "react";

type State = { error?: string; values?: Record<string, string> };

const never = () => () => {};

/**
 * A lost connection is the one failure a person can fix themselves, so it is told apart: the form
 * stays where it is, with what they typed. A server error still reaches the error screen.
 *
 * The server's own action is kept until the page has hydrated. A wrapped action runs in the
 * browser, so wrapping it from the first render would stop the form working with JavaScript off.
 */
export function useSafely<S extends State>(action: (prev: S, fd: FormData) => Promise<S>) {
  const hydrated = useSyncExternalStore(never, () => true, () => false);
  if (!hydrated) return action;
  return async (prev: S, fd: FormData): Promise<S> => {
    try {
      return await action(prev, fd);
    } catch (err) {
      if (!(err instanceof TypeError)) throw err;
      const values: Record<string, string> = {};
      fd.forEach((v, k) => {
        if (typeof v === "string" && !/password|confirm|code/i.test(k)) values[k] = v;
      });
      return { ...prev, values, error: "We couldn't reach Sagora. Check your connection and try again." };
    }
  };
}
