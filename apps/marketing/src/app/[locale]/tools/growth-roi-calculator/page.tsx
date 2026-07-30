// @input  -- locale param
// @output -- permanent redirect from a retired assumption-led calculator to the tools hub
// @pos    -- legacy URL compatibility; public tools must not present unsupported ROI projections
// once this file is updated, update header comments and _DIR.md in this folder
import { permanentRedirect } from "next/navigation";

export default async function GrowthROICalculatorPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  permanentRedirect(`/${locale}/tools`);
}
