import { PageProgress } from "@/components/app/PageProgress";
import { ConfirmHost } from "@/components/app/ConfirmHost";
import { Toaster } from "@/components/app/Toaster";
import { ConnectionBanner } from "@/components/app/ConnectionBanner";
import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import localFont from "next/font/local";
import "./globals.css";

// The design sets every button label in Inter, and everything else in Geist.
const inter = localFont({ src: "./fonts/inter-latin.woff2", weight: "100 900", variable: "--font-inter" });

export const metadata: Metadata = {
  title: { default: "Sagora", template: "%s · Sagora" },
  description: "Book agricultural services and run your service business in one place.",
};

// viewportFit lets the page run under a phone's notch; the CSS keeps content out of it.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f7f8f2" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${inter.variable}`}>
      <body>
        {children}
        <PageProgress />
        <Toaster />
        <ConnectionBanner />
        <ConfirmHost />
      </body>
    </html>
  );
}
