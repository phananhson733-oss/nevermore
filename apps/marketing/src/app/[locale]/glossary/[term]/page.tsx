// @input  -- locale route param, next/navigation
// @output -- permanent legacy redirect to the editorial library
// @pos    -- retires unverified glossary detail URLs without creating dead ends
import { permanentRedirect } from "next/navigation";

export default async function GlossaryTermPage({
  params,
}: {
  params: Promise<{ locale: string; term: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/blog`);
}
