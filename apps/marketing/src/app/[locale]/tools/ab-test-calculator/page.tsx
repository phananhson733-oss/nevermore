// @input  -- locale route param
// @output -- permanent redirect from a tool outside the five-tool public architecture
// @pos    -- preserves old links while keeping the public tool matrix coherent
import { permanentRedirect } from "next/navigation";
import { localePath } from "@/lib/locale-path";

export default async function ABTestCalculatorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(localePath(locale, "/tools"));
}
