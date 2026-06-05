import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  weight: "100 900",
});
const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  weight: "100 900",
});

export const metadata: Metadata = {
  title: "鬥地主 & 五子棋",
  description: "線上鬥地主與五子棋牌局",
  // Whole-app PWA manifest (covers the unified lobby + both games).
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    title: "棋牌",
    statusBarStyle: "black-translucent",
  },
  icons: {
    // iOS Safari uses apple-touch-icon for the home-screen icon (it ignores
    // the manifest icons). 180x180 is the recommended size.
    apple: "/icons/apple-icon-180.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1a4731",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
