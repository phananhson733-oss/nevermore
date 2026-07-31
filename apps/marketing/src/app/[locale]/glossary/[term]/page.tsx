// @input  -- locale route param, next/navigation
// @output -- permanent legacy redirect to the editorial library
// @pos    -- retires unverified glossary detail URLs without creating dead ends
import { permanentRedirect } from "next/navigation";
import { localePath } from "@/lib/locale-path";

export default async function GlossaryTermPage({
  params,
}: {
  params: Promise<{ locale: string; term: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(localePath(locale, "/blog"));
}
