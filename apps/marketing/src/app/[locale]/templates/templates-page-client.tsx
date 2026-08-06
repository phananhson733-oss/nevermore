// @input  -- next-intl, framer-motion, waitlist-context, site config
// @output -- Templates page client rendering (5 blocks)
// @pos    -- Templates page client wrapper, referenced by page.tsx server component
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { fadeInUp, staggerContainer, staggerItem } from "@/lib/animations";
import { BottomCtaSection } from "@/components/home/bottom-cta-section";
import { useTrial } from "@/components/layout/waitlist-context";
import {
  Lightbulb,
  Zap,
  BarChart3,
  Crosshair,
  TrendingUp,
  Search,
  Link2,
  type LucideIcon,
} from "lucide-react";
import { TemplatesExperimentSection } from "./templates-experiment-section";

const FRAMEWORK_STEPS: { key: string; descKey: string; icon: LucideIcon }[] = [
  { key: "step1", descKey: "step1Desc", icon: Lightbulb },
  { key: "step2", descKey: "step2Desc", icon: Zap },
  { key: "step3", descKey: "step3Desc", icon: BarChart3 },
  { key: "step4", descKey: "step4Desc", icon: Crosshair },
];

const PLAYBOOKS: { titleKey: string; descKey: string; icon: LucideIcon }[] = [
  { titleKey: "pb1Title", descKey: "pb1Desc", icon: TrendingUp },
  { titleKey: "pb2Title", descKey: "pb2Desc", icon: Search },
  { titleKey: "pb3Title", descKey: "pb3Desc", icon: Link2 },
];

export default function TemplatesPageClient() {
  const tHero = useTranslations("templates.hero");
  const tFw = useTranslations("templates.framework");
  const tPb = useTranslations("templates.playbooks");
  const { openWaitlist } = useTrial();

  return (
    <>
      {/* Block 1: Hero (页级 hero) */}
      <section className="bg-brand-bg relative overflow-hidden pt-16 pb-16 md:pt-21 md:pb-20">
        {/* GLOW_01 — 48px 网格线 + 氛围光，全站仅首屏与页级 hero 出现 */}
        <div
          aria-hidden="true"
          className="bg-signal-grid absolute inset-0 opacity-40"
        />
        <div
          aria-hidden="true"
          className="absolute -top-30 right-[6%] hidden h-70 w-100 rounded-full bg-[radial-gradient(ellipse,rgba(61,220,151,0.13),transparent_65%)] blur-[12px] md:block"
        />
        <div className="max-w-content relative mx-auto px-6 text-center md:px-8">
          <motion.h1 {...fadeInUp} className="text-text-dark-primary">
            {tHero("title")}
          </motion.h1>
          <motion.p
            {...fadeInUp}
            transition={{ ...fadeInUp.transition, delay: 0.15 }}
            className="text-text-dark-secondary mx-auto mt-5 max-w-2xl text-[17.5px] leading-[1.65]"
          >
            {tHero("subtitle")}
          </motion.p>
        </div>
      </section>

      {/* Block 2: Experiment Framework */}
      <section className="bg-brand-bg-alt border-brand-border border-t py-16 md:py-22">
        <div className="max-w-content mx-auto px-6 md:px-8">
          <motion.h2
            initial={{ opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{
              duration: 0.45,
              ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
            }}
            className="text-text-dark-primary mb-11 text-center"
          >
            {tFw("title")}
          </motion.h2>

          <motion.div
            {...staggerContainer}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4"
          >
            {FRAMEWORK_STEPS.map((step, i) => (
              <motion.div
                key={step.key}
                {...staggerItem}
                className="border-brand-border-card bg-brand-panel rounded-card border p-[22px]"
              >
                <div
                  className="mb-3 flex items-center gap-3"
                  aria-hidden="true"
                >
                  <span className="text-text-dark-faint font-mono text-[10px] tracking-[0.12em]">
                    STEP_{String(i + 1).padStart(2, "0")}
                  </span>
                  <step.icon className="text-brand-accent size-[17px] shrink-0" />
                </div>
                <h3 className="text-text-dark-primary mb-2 text-[15.5px] font-semibold">
                  {tFw(step.key)}
                </h3>
                <p className="text-text-dark-secondary text-[12.5px] leading-[1.6]">
                  {tFw(step.descKey)}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Block 3: Playbook Templates */}
      <section className="bg-brand-bg border-brand-border border-t py-16 md:py-22">
        <div className="max-w-content mx-auto px-6 md:px-8">
          <motion.h2
            {...fadeInUp}
            whileInView="animate"
            initial="initial"
            viewport={{ once: true }}
            className="text-text-dark-primary mb-11 text-center"
          >
            {tPb("title")}
          </motion.h2>

          <motion.div
            {...staggerContainer}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            className="grid grid-cols-1 gap-4 md:grid-cols-3"
          >
            {PLAYBOOKS.map((pb) => (
              <motion.div
                key={pb.titleKey}
                {...staggerItem}
                className="border-brand-border-card bg-brand-panel rounded-card border p-[26px]"
              >
                <div
                  className="border-brand-accent/25 bg-brand-accent-soft text-brand-accent mb-4 flex size-10 items-center justify-center rounded-[10px] border"
                  aria-hidden="true"
                >
                  <pb.icon className="size-[17px]" />
                </div>
                <h3 className="text-text-dark-primary mb-2 text-[16.5px] font-semibold">
                  {tPb(pb.titleKey)}
                </h3>
                <p className="text-text-dark-secondary text-[13px] leading-[1.6]">
                  {tPb(pb.descKey)}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Block 4: Live Experiment Entry */}
      <TemplatesExperimentSection />

      {/* Block 5: Bottom CTA */}
      <BottomCtaSection onOpenWaitlist={openWaitlist} />
    </>
  );
}
