"use client";

import { useEffect } from "react";
import Image from "next/image";
import Link from "next/link";

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Page failed", error.digest ?? error.message);
  }, [error]);
  const offline = typeof navigator !== "undefined" && !navigator.onLine;
  return (
    <main className="setup">
      <div className="setup__card door">
        <Image src="/brand/logo-mark.svg" alt="Sagora" width={70} height={65} />
        <h1 className="auth__title">{offline ? "You seem to be offline" : "Something went wrong"}</h1>
        <p className="auth__subtitle">{offline ? "Check your connection, then try again." : "Nothing you saved has been lost. Please try again."}</p>
        <button type="button" className="button" onClick={reset}>Try again</button>
        <Link href="/" className="button button--soft">Go to Sagora</Link>
      </div>
    </main>
  );
}
