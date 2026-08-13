// @input  -- locale route param from the retired public SEO Audit URL
// @output -- permanent, locale-preserving redirect to the SEO Agent
// @pos    -- compatibility shim; authenticated execution now lives at /agents/seo

import { permanentRedirect } from "next/navigation";
import { localePath } from "../../../../lib/locale-path";

export default async function SeoAuditPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(localePath(locale, "/agents/seo"));
}
