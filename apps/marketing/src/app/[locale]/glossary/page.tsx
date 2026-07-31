// @input  -- locale route param, next/navigation
// @output -- permanent legacy redirect to the editorial library
// @pos    -- retires noindex glossary pages until a verified terminology corpus exists
import { permanentRedirect } from "next/navigation";
import { localePath } from "@/lib/locale-path";

export default async function GlossaryPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(localePath(locale, "/blog"));
}
