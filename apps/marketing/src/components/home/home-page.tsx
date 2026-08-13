// @input  -- HeroSection(eager), 6 homepage block components(lazy)
// @output -- HomePage client component for the Agent acquisition path
// @pos    -- Homepage assembly layer, used by [locale]/page.tsx
// Once this file is updated, update header comment and folder _DIR.md
"use client";

import dynamic from "next/dynamic";
import { HeroSection } from "./hero-section";

const PainPointsSection = dynamic(() =>
  import("./pain-points-section").then((mod) => ({
    default: mod.PainPointsSection,
  })),
);
const SolutionSection = dynamic(() =>
  import("./solution-section").then((mod) => ({
    default: mod.SolutionSection,
  })),
);
const CapabilitiesPreview = dynamic(() =>
  import("./capabilities-preview").then((mod) => ({
    default: mod.CapabilitiesPreview,
  })),
);
const SocialProofSection = dynamic(() =>
  import("./social-proof-section").then((mod) => ({
    default: mod.SocialProofSection,
  })),
);
const EditorialPreviewSection = dynamic(() =>
  import("./editorial-preview-section").then((mod) => ({
    default: mod.EditorialPreviewSection,
  })),
);
const BottomCtaSection = dynamic(() =>
  import("./bottom-cta-section").then((mod) => ({
    default: mod.BottomCtaSection,
  })),
);

export function HomePage() {
  return (
    <>
      <HeroSection />
      <CapabilitiesPreview />
      <PainPointsSection />
      <SolutionSection />
      <SocialProofSection />
      <EditorialPreviewSection />
      <BottomCtaSection />
    </>
  );
}
