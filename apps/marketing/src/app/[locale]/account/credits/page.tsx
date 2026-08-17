// @input  -- locale route param, the credits.account copy, CreditsAccountClient
// @output -- the signed-in visitor's credits page, kept out of search results
// @pos    -- the only account-scoped route on the marketing site
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { CreditsAccountClient } from "@/components/credits/credits-account-client";
import { generatePageMetadata } from "@/lib/seo";

// Everything below the heading belongs to one session and is fetched after
// hydration. Prerendering the shell would cache a frame that is identical and
// empty for every visitor, and hand the CDN a page it must never reuse.
export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "credits.account" });
  return generatePageMetadata({
    title: t("title"),
    description: t("subtitle"),
    locale,
    path: "/account/credits",
    // A personal ledger has nothing to offer a crawler, and this route is not
    // in sitemap.ts for the same reason.
    noIndex: true,
  });
}

export default async function CreditsAccountPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  const [t, messages] = await Promise.all([
    getTranslations({ locale, namespace: "credits.account" }),
    getMessages(),
  ]);

  return (
    <section className="min-h-screen bg-brand-bg px-6 pt-9 pb-24 md:px-8">
      <div className="mx-auto max-w-3xl">
        <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
          GenGrowth
        </p>
        <h1 className="text-page-title mt-4 text-text-dark-primary">
          {t("title")}
        </h1>
        <p className="mt-4 text-[15.5px] leading-[1.65] text-text-dark-secondary">
          {t("subtitle")}
        </p>
        <div className="mt-8">
          {/* Only this namespace, not the whole catalog: the shell already
              serializes `credits` for the header badge, and naming it here
              keeps the page working if that ever stops being true. */}
          <NextIntlClientProvider messages={{ credits: messages.credits }}>
            <CreditsAccountClient />
          </NextIntlClientProvider>
        </div>
      </div>
    </section>
  );
}
