"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

const subscribe = (change: () => void) => {
  window.addEventListener("online", change);
  window.addEventListener("offline", change);
  return () => {
    window.removeEventListener("online", change);
    window.removeEventListener("offline", change);
  };
};

/**
 * UC16: says plainly when the phone has lost its connection, and when it is back, so nobody
 * presses Send into nothing and takes the silence for success. What was typed stays in the form.
 */
export function ConnectionBanner() {
  // The server cannot know, so it draws nothing; the browser takes over straight away.
  const online = useSyncExternalStore(subscribe, () => navigator.onLine, () => true);
  const [back, setBack] = useState(false);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const on = () => {
      setBack(true);
      clearTimeout(timer);
      timer = setTimeout(() => setBack(false), 4000);
    };
    const off = () => { clearTimeout(timer); setBack(false); };
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  if (online && !back) return null;
  return (
    <p className={`connection connection--${online ? "back" : "offline"}`} role="status" aria-live="polite">
      {online
        ? "You are back online. Send again anything that did not go through."
        : "You are offline. Nothing can be sent until the connection is back. What you have typed is kept."}
    </p>
  );
}
