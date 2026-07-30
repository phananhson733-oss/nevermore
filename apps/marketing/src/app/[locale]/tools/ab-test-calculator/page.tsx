// @input  -- locale route param
// @output -- permanent redirect from a tool outside the five-tool public architecture
// @pos    -- preserves old links while keeping the public tool matrix coherent
import { permanentRedirect } from "next/navigation";

export default async function ABTestCalculatorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/tools`);
}
