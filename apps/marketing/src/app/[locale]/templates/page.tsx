// @input  -- locale route param, next/navigation
// @output -- permanent legacy redirect to the current editorial library
// @pos    -- retires the noindex template hub in favor of repository-backed articles
import { permanentRedirect } from "next/navigation";
import { localePath } from "@/lib/locale-path";

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(localePath(locale, "/blog"));
}
