import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
export const metadata: Metadata = {
  title: "Daywell — your daily tracker",
  description: "Track muscle recovery, hydration, and meals.",
  applicationName: "Daywell",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Daywell" },
  icons: { icon: "/icons/icon-192.png", apple: "/icons/apple-touch-icon.png" },
};
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f6f7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#151d1a" },
  ],
};
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
