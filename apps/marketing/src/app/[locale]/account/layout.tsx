// @input  -- locale route param and all private account route children
// @output -- request-rendered noindex account settings frame
// @pos    -- shared layout boundary for /account/*

import type { Metadata } from "next";
import type { ReactNode } from "react";

import { AccountSettingsShell } from "@/components/account/account-settings-shell";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};

export default async function AccountLayout({
  children,
  params,
}: {
  readonly children: ReactNode;
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const { locale } = await params;
  return (
    <AccountSettingsShell locale={locale}>{children}</AccountSettingsShell>
  );
}
