import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

export const metadata: Metadata = { title: "Page not found" };

export default function NotFound() {
  return (
    <main className="setup">
      <div className="setup__card door">
        <Image src="/brand/logo-mark.svg" alt="Sagora" width={70} height={65} />
        <h1 className="auth__title">We can&apos;t find that page</h1>
        <p className="auth__subtitle">The link may be old or mistyped.</p>
        <Link href="/" className="button">Go to Sagora</Link>
      </div>
    </main>
  );
}
