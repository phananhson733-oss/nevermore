// @input  -- locale param
// @output -- permanent redirect from legacy comparison hub to Blog comparison section
// @pos    -- legacy URL compatibility after comparisons moved into Blog
// once this file is updated, update header comments and _DIR.md in this folder
import { permanentRedirect } from "next/navigation";
import { localePath } from "@/lib/locale-path";

export default async function ComparePage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(`${localePath(locale, "/blog")}#comparisons`);
}
