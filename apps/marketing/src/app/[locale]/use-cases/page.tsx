// @input  -- locale route param, next/navigation
// @output -- permanent legacy redirect to the editorial library
// @pos    -- retires noindex use-case claims until verified customer evidence exists
import { permanentRedirect } from "next/navigation";
import { localePath } from "@/lib/locale-path";

export default async function UseCasesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(localePath(locale, "/blog"));
}
