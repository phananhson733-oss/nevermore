import type { Metadata } from "next";
import { Fraunces, Manrope } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

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

export const metadata: Metadata = {
  title: "GenGrowth",
  description: "Connected diagnosis and delivery workbench",
};

export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const locale = await getLocale();
  const messages = await getMessages();
  return (
    <html lang={locale} className={`${fraunces.variable} ${manrope.variable}`}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
