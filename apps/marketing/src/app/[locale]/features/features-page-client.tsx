// @input  — next-intl, CapabilityBlock, BottomCtaSection, waitlist-context
// @output — Features 核心能力页面客户端渲染（6 个能力区块）
// @pos    — Features 页 client wrapper，由 page.tsx server component 引用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/animations";
import { CapabilityBlock } from "@/components/features/capability-block";
import {
  DiscoveryVisual,
  StrategyVisual,
  ExecutionVisual,
  AttributionVisual,
  OptimizationVisual,
  GovernanceVisual,
} from "@/components/features/visuals";
import { BottomCtaSection } from "@/components/home/bottom-cta-section";
import { useTrial } from "@/components/layout/waitlist-context";

const CAPABILITIES = [
  {
    ns: "discovery",
    features: ["f1", "f2", "f3", "f4"],
    isDark: false,
    pillarSlug: "seo_content",
  },
  {
    ns: "strategy",
    features: ["f1", "f2", "f3"],
    isDark: true,
    reverse: true,
    pillarSlug: "experiment_driven",
  },
  {
    ns: "execution",
    features: ["f1", "f2", "f3", "f4"],
    isDark: false,
    pillarSlug: "growth_automation",
  },
  {
    ns: "attribution",
    features: ["f1", "f2", "f3", "f4"],
    isDark: true,
    reverse: true,
    pillarSlug: "attribution",
  },
  {
    ns: "optimization",
    features: ["f1", "f2", "f3", "f4"],
    isDark: false,
    pillarSlug: "experiment_driven",
  },
  {
    ns: "governance",
    features: ["f1", "f2", "f3", "f4"],
    isDark: true,
    reverse: true,
    pillarSlug: "growth_automation",
  },
] as const;

const VISUALS: Record<string, (isDark: boolean) => React.ReactNode> = {
  discovery: (isDark) => <DiscoveryVisual isDark={isDark} />,
  strategy: (isDark) => <StrategyVisual isDark={isDark} />,
  execution: (isDark) => <ExecutionVisual isDark={isDark} />,
  attribution: (isDark) => <AttributionVisual isDark={isDark} />,
  optimization: (isDark) => <OptimizationVisual isDark={isDark} />,
  governance: (isDark) => <GovernanceVisual isDark={isDark} />,
};

export default function FeaturesPageClient() {
  const t = useTranslations("features.hero");
  const { openWaitlist } = useTrial();

  return (
    <>
      {/* Hero */}
      <section className="bg-brand-bg py-16 md:py-24">
        <div className="max-w-content mx-auto px-4 text-center">
          <motion.h1
            {...fadeInUp}
            className="text-text-dark-primary font-semibold mb-4"
          >
            {t("title")}
          </motion.h1>
          <motion.p
            {...fadeInUp}
            transition={{ ...fadeInUp.transition, delay: 0.15 }}
            className="text-text-dark-secondary text-lg max-w-2xl mx-auto"
          >
            {t("subtitle")}
          </motion.p>
        </div>
      </section>

      {/* 6 Capability Blocks */}
      {CAPABILITIES.map((cap) => (
        <CapabilityBlock
          key={cap.ns}
          ns={cap.ns}
          features={[...cap.features]}
          isDark={cap.isDark}
          reverse={"reverse" in cap ? cap.reverse : false}
          visual={VISUALS[cap.ns]?.(cap.isDark)}
          onCtaClick={openWaitlist}
          pillarSlug={cap.pillarSlug}
        />
      ))}

      {/* Bottom CTA */}
      <BottomCtaSection onOpenWaitlist={openWaitlist} />
    </>
  );
}
