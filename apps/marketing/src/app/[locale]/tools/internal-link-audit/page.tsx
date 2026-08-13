// @input  -- locale route param from the retired public Internal Link Audit URL
// @output -- permanent, locale-preserving redirect to the Tech Agent
// @pos    -- compatibility shim; authenticated execution now lives at /agents/tech

import { permanentRedirect } from "next/navigation";
import { localePath } from "../../../../lib/locale-path";

export default async function InternalLinkAuditPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(localePath(locale, "/agents/tech"));
}
