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
      <section className="relative overflow-hidden bg-brand-bg pt-16 pb-16 md:pt-21 md:pb-22">
        {/* GLOW_01 — 页级 hero 才允许的 48px 网格 + 单个氛围光 */}
        <div
          aria-hidden="true"
          className="bg-signal-grid absolute inset-0 opacity-40"
        />
        <div
          aria-hidden="true"
          className="absolute -top-30 right-[4%] hidden h-70 w-100 rounded-full bg-[radial-gradient(ellipse,rgba(61,220,151,0.13),transparent_65%)] blur-[12px] md:block"
        />
        <div className="max-w-content relative mx-auto px-6 text-center md:px-8">
          <motion.h1 {...fadeInUp} className="text-text-dark-primary">
            {t("title")}
          </motion.h1>
          <motion.p
            {...fadeInUp}
            transition={{ ...fadeInUp.transition, delay: 0.15 }}
            className="mx-auto mt-5 max-w-2xl text-[15.5px] leading-[1.65] text-text-dark-secondary md:text-[17px]"
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
