import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import localFont from "next/font/local";
import NotFound from "./(platform)/not-found";
import "./(platform)/globals.css";

// An address that matches no page at all. The landing page and the app each have their own
// root layout, so this one draws the app's 404 with the app's styles itself.
const inter = localFont({ src: "./(platform)/fonts/inter-latin.woff2", weight: "100 900", variable: "--font-inter" });

export const metadata: Metadata = { title: "Page not found · Sagora" };

export default function GlobalNotFound() {
  return (
    <html lang="en" className={`${GeistSans.variable} ${inter.variable}`}>
      <body>
        <NotFound />
      </body>
    </html>
  );
}
