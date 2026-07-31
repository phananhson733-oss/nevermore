// @input  -- locale route param, next/navigation
// @output -- permanent legacy redirect to the editorial library
// @pos    -- retires sample-data playbook detail URLs without creating dead ends
import { permanentRedirect } from "next/navigation";
import { localePath } from "@/lib/locale-path";

export default async function PlaybookDetailPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(localePath(locale, "/blog"));
}
