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
      {/* Block 1: Hero */}
      <section className="bg-brand-bg py-16 md:py-24">
        <div className="max-w-content mx-auto px-4 text-center">
          <motion.h1
            {...fadeInUp}
            className="text-text-dark-primary font-semibold mb-4"
          >
            {tHero("title")}
          </motion.h1>
          <motion.p
            {...fadeInUp}
            transition={{ ...fadeInUp.transition, delay: 0.15 }}
            className="text-text-dark-secondary text-lg max-w-2xl mx-auto"
          >
            {tHero("subtitle")}
          </motion.p>
        </div>
      </section>

      {/* Block 2: Experiment Framework */}
      <section className="bg-brand-bg-light py-16 md:py-24">
        <div className="max-w-content mx-auto px-4">
          <motion.h2
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{
              duration: 0.6,
              ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
            }}
            className="text-text-light-primary font-semibold text-center mb-12"
          >
            {tFw("title")}
          </motion.h2>

          <motion.div
            {...staggerContainer}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
          >
            {FRAMEWORK_STEPS.map((step, i) => (
              <motion.div
                key={step.key}
                {...staggerItem}
                className="bg-white border border-gray-200 rounded-card p-6 text-center"
              >
                <div className="mb-3" aria-hidden="true">
                  <step.icon className="size-7 text-brand-accent-on-light mx-auto" />
                </div>
                <div className="text-brand-accent-on-light font-mono text-xs mb-2">
                  {String(i + 1).padStart(2, "0")}
                </div>
                <h3 className="text-text-light-primary font-semibold text-base mb-1">
                  {tFw(step.key)}
                </h3>
                <p className="text-text-light-secondary text-sm">
                  {tFw(step.descKey)}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Block 3: Playbook Templates */}
      <section className="bg-brand-bg py-16 md:py-24">
        <div className="max-w-content mx-auto px-4">
          <motion.h2
            {...fadeInUp}
            whileInView="animate"
            initial="initial"
            viewport={{ once: true }}
            className="text-text-dark-primary font-semibold text-center mb-12"
          >
            {tPb("title")}
          </motion.h2>

          <motion.div
            {...staggerContainer}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            className="grid grid-cols-1 md:grid-cols-3 gap-6"
          >
            {PLAYBOOKS.map((pb) => (
              <motion.div
                key={pb.titleKey}
                {...staggerItem}
                className="border border-brand-border rounded-card p-6"
              >
                <div className="mb-3" aria-hidden="true">
                  <pb.icon className="size-6 text-brand-accent" />
                </div>
                <h3 className="text-text-dark-primary font-semibold text-base mb-2">
                  {tPb(pb.titleKey)}
                </h3>
                <p className="text-text-dark-secondary text-sm">
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
