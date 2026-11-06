import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import "./landing.css";

// The landing page has its own root layout: it is drawn at full size with its own styles,
// while the app is drawn at 75% on desktop. Moving between them is a normal page load.
export const metadata: Metadata = {
  title: "Sagora — Agricultural services in Sierra Leone",
  description:
    "Sagora connects farmers with agricultural service providers for ploughing, planting and harvesting, while giving providers the tools to manage their equipment, jobs and payments.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, themeColor: "#f7f8f2" };

export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={GeistSans.variable}>
      <body>{children}</body>
    </html>
  );
}
