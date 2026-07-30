// @input  — next-intl, framer-motion, waitlist-context, BottomCtaSection
// @output — About 关于页面客户端渲染（4 个区块，7 条设计原则）
// @pos    — About 页 client wrapper，由 page.tsx server component 引用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { fadeInUp, staggerContainer, staggerItem } from "@/lib/animations";
import { BottomCtaSection } from "@/components/home/bottom-cta-section";
import { useTrial } from "@/components/layout/waitlist-context";
import {
  Crosshair,
  Bot,
  Search,
  BarChart3,
  Shield,
  RefreshCw,
  Globe,
  type LucideIcon,
} from "lucide-react";

const PRINCIPLES: { key: string; icon: LucideIcon }[] = [
  { key: "minimalInput", icon: Crosshair },
  { key: "autoStrategy", icon: Bot },
  { key: "evidence", icon: Search },
  { key: "signalDriven", icon: BarChart3 },
  { key: "override", icon: Shield },
  { key: "reusable", icon: RefreshCw },
  { key: "openSource", icon: Globe },
];

export default function AboutPageClient() {
  const tHero = useTranslations("about.hero");
  const tPrinciples = useTranslations("about.principles");
  const tFounder = useTranslations("about.founder");
  const { openWaitlist } = useTrial();

  return (
    <>
      {/* Block 1: Hero (dark) */}
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

      {/* Block 2: Design Principles (light) */}
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
            {tPrinciples("title")}
          </motion.h2>

          <motion.div
            {...staggerContainer}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
          >
            {PRINCIPLES.map((p, idx) => (
              <motion.div
                key={p.key}
                {...staggerItem}
                className="bg-white border border-gray-200 rounded-card p-6"
              >
                <div className="flex items-center gap-3 mb-3">
                  <span
                    className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-accent/10 text-brand-accent-on-light text-xs font-semibold"
                    aria-hidden="true"
                  >
                    {idx + 1}
                  </span>
                  <p.icon
                    className="size-5 text-brand-accent-on-light shrink-0"
                    aria-hidden="true"
                  />
                </div>
                <h3 className="text-text-light-primary font-semibold text-base mb-2">
                  {tPrinciples(`${p.key}.title`)}
                </h3>
                <p className="text-text-light-secondary text-sm leading-relaxed">
                  {tPrinciples(`${p.key}.desc`)}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Block 3: Founder Note (dark) */}
      <section className="bg-brand-bg py-16 md:py-24">
        <div className="max-w-3xl mx-auto px-4">
          <motion.h2
            {...fadeInUp}
            whileInView="animate"
            initial="initial"
            viewport={{ once: true }}
            className="text-text-dark-primary font-semibold text-center mb-8"
          >
            {tFounder("title")}
          </motion.h2>
          <motion.blockquote
            {...fadeInUp}
            whileInView="animate"
            initial="initial"
            viewport={{ once: true }}
            transition={{ ...fadeInUp.transition, delay: 0.15 }}
            className="text-text-dark-secondary text-lg leading-relaxed border-l-2 border-brand-accent pl-6"
          >
            {tFounder("quote")}
          </motion.blockquote>
          <motion.p
            {...fadeInUp}
            whileInView="animate"
            initial="initial"
            viewport={{ once: true }}
            transition={{ ...fadeInUp.transition, delay: 0.3 }}
            className="text-text-dark-secondary text-sm mt-6 text-right"
          >
            {tFounder("attribution")}
          </motion.p>
        </div>
      </section>

      {/* Block 4: Bottom CTA (dark) */}
      <BottomCtaSection onOpenWaitlist={openWaitlist} />
    </>
  );
}
