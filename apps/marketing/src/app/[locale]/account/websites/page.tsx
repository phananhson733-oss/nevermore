// @input  -- locale route param, account.websites copy, account namespace messages, WebsitesAccountClient
// @output -- private account website list page
// @pos    -- default account settings module

import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { WebsitesAccountClient } from "@/components/account/websites-account-client";
import { generatePageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account.websites" });
  return generatePageMetadata({
    title: t("title"),
    description: t("subtitle"),
    locale,
    path: "/account/websites",
    noIndex: true,
  });
}

export default async function AccountWebsitesPage({
  params,
}: {
  readonly params: Promise<{ readonly locale: string }>;
}) {
  const { locale } = await params;
  const [t, messages] = await Promise.all([
    getTranslations({ locale, namespace: "account.websites" }),
    getMessages(),
  ]);

  return (
    <NextIntlClientProvider messages={{ account: messages.account }}>
      <div>
        <div className="max-w-2xl">
          <h2 className="text-[24px] leading-tight font-semibold text-text-dark-primary">
            {t("title")}
          </h2>
          <p className="mt-2 text-[14px] leading-[1.65] text-text-dark-secondary">
            {t("subtitle")}
          </p>
        </div>
        <div className="mt-7">
          <WebsitesAccountClient />
        </div>
      </div>
    </NextIntlClientProvider>
  );
}
