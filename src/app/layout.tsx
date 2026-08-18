// src/app/layout.tsx
import type { Metadata, Viewport } from "next";
import { Archivo, Bricolage_Grotesque, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const display = Bricolage_Grotesque({ subsets: ["latin"], variable: "--f-display" });
const sans = Archivo({ subsets: ["latin"], variable: "--f-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], variable: "--f-mono", weight: ["400", "500"] });

export const metadata: Metadata = {
  title: "Travel Fotos",
  description: "Sharing is caring",
  appleWebApp: { capable: true, statusBarStyle: "black-translucent", title: "Travel Fotos" },
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/old_insta.webp",
    shortcut: "/old_insta.webp",
    apple: "/old_insta.webp",
  },
};

export const viewport: Viewport = {
  themeColor: "#061219",
  width: "device-width",
  initialScale: 1,
  // Let people pinch into a photo. Locking zoom on a photo app is hostile.
  maximumScale: 5,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
