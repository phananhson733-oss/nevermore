// @input  -- HeroSection(eager), 6 homepage block components(lazy)
// @output -- HomePage client component (assembles 7 blocks, Hero uses openTrial, BottomCTA uses openWaitlist)
// @pos    -- Homepage assembly layer, used by [locale]/page.tsx
// Once this file is updated, update header comment and folder _DIR.md
"use client";

import dynamic from "next/dynamic";
import { HeroSection } from "./hero-section";

const StatsSection = dynamic(() =>
  import("./stats-section").then((mod) => ({ default: mod.StatsSection })),
);
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
const BottomCtaSection = dynamic(() =>
  import("./bottom-cta-section").then((mod) => ({
    default: mod.BottomCtaSection,
  })),
);

interface HomePageProps {
  onOpenTrial?: () => void;
  onOpenWaitlist?: () => void;
}

export function HomePage({ onOpenTrial, onOpenWaitlist }: HomePageProps) {
  return (
    <>
      <HeroSection onOpenTrial={onOpenTrial} />
      <StatsSection />
      <PainPointsSection />
      <SolutionSection />
      <CapabilitiesPreview />
      <SocialProofSection />
      <BottomCtaSection onOpenWaitlist={onOpenWaitlist} />
    </>
  );
}
