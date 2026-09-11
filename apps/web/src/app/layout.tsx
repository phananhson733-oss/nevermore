import type { Metadata } from "next";
import { Fraunces, Manrope, Plus_Jakarta_Sans } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";
import "./workbench.css";

// Self-hosted at build time (served from our own origin, so the strict
// `font-src 'self'` CSP is satisfied — no runtime request to a font CDN).
// Fraunces = editorial serif display (heroes, big numbers); Manrope = body.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
});
const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
});

// Workbench body face (design source: opengengrowth). Self-hosted like the two
// above; Chinese glyphs fall back to the system stack declared in workbench.css.
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  weight: "variable", // Plus Jakarta Sans is a variable face (wght 200-800): one file instead of five
  variable: "--font-wb",
  display: "swap",
});

export const metadata: Metadata = {
  title: "GenGrowth",
  applicationName: "GenGrowth",
  description: "Connected diagnosis and delivery workbench",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" },
      { url: "/icon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192x192.png", sizes: "192x192", type: "image/png" },
    ],
    shortcut: [{ url: "/favicon.ico", type: "image/x-icon" }],
    apple: [
      {
        url: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png",
      },
    ],
  },
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html
      lang={locale}
      data-theme="light"
      className={`${fraunces.variable} ${manrope.variable} ${plusJakarta.variable}`}
    >
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
