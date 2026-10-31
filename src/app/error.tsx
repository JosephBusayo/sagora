"use client";

import Image from "next/image";
import Link from "next/link";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="setup">
      <div className="setup__card door">
        <Image src="/brand/logo-mark.svg" alt="Sagora" width={70} height={65} />
        <h1 className="auth__title">Something went wrong</h1>
        <p className="auth__subtitle">Nothing you saved has been lost. Please try again.</p>
        <button type="button" className="button" onClick={reset}>Try again</button>
        <Link href="/" className="button button--soft">Go to Sagora</Link>
      </div>
    </main>
  );
}
