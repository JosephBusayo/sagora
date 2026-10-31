import { PageProgress } from "@/components/app/PageProgress";
import { TableLabels } from "@/components/app/TableLabels";
import { ConfirmHost } from "@/components/app/ConfirmHost";
import { Toaster } from "@/components/app/Toaster";
import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "Sagora", template: "%s · Sagora" },
  description: "Book agricultural services and run your service business in one place.",
};

// viewportFit lets the page run under a phone's notch; the CSS keeps content out of it.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#f7f8f2" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body>
        {children}
        <PageProgress />
        <TableLabels />
        <Toaster />
        <ConfirmHost />
      </body>
    </html>
  );
}
