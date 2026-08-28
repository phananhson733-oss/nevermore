// @input  -- locale/website route params, optional generate intent, account messages
// @output -- private website Product/ICP editor
// @pos    -- per-website settings route

import { NextIntlClientProvider } from "next-intl";
import { getMessages, getTranslations } from "next-intl/server";

import { WebsiteProfileEditor } from "@/components/account/website-profile-editor";
import { generatePageMetadata } from "@/lib/seo";

export const dynamic = "force-dynamic";

interface WebsitePageProps {
  readonly params: Promise<{
    readonly locale: string;
    readonly websiteId: string;
  }>;
  readonly searchParams: Promise<{ readonly generate?: string }>;
}

export async function generateMetadata({
  params,
}: Pick<WebsitePageProps, "params">) {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "account.websites" });
  return generatePageMetadata({
    title: t("edit"),
    description: t("subtitle"),
    locale,
    path: "/account/websites",
    noIndex: true,
  });
}

export default async function AccountWebsiteProfilePage({
  params,
  searchParams,
}: WebsitePageProps) {
  const [{ websiteId }, { generate }, messages] = await Promise.all([
    params,
    searchParams,
    getMessages(),
  ]);

  return (
    <NextIntlClientProvider messages={{ account: messages.account }}>
      <WebsiteProfileEditor
        websiteId={websiteId}
        autoGenerate={generate === "1"}
      />
    </NextIntlClientProvider>
  );
}
