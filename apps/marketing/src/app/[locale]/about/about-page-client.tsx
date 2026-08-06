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

      {/* Block 2: Design Principles (alt surface) */}
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
            {tPrinciples("title")}
          </motion.h2>

          <motion.div
            {...staggerContainer}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4"
          >
            {PRINCIPLES.map((p, idx) => (
              <motion.div
                key={p.key}
                {...staggerItem}
                className="border-brand-border-card bg-brand-panel rounded-card border p-[22px]"
              >
                <div className="mb-3 flex items-center gap-3">
                  <span
                    className="text-text-dark-faint font-mono text-[10px] tracking-[0.12em]"
                    aria-hidden="true"
                  >
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  <p.icon
                    className="text-brand-accent size-[17px] shrink-0"
                    aria-hidden="true"
                  />
                </div>
                <h3 className="text-text-dark-primary mb-2 text-[15.5px] font-semibold">
                  {tPrinciples(`${p.key}.title`)}
                </h3>
                <p className="text-text-dark-secondary text-[12.5px] leading-[1.6]">
                  {tPrinciples(`${p.key}.desc`)}
                </p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* Block 3: Founder Note */}
      <section className="bg-brand-bg border-brand-border border-t py-16 md:py-22">
        <div className="mx-auto max-w-3xl px-6 md:px-8">
          <motion.h2
            {...fadeInUp}
            whileInView="animate"
            initial="initial"
            viewport={{ once: true }}
            className="text-text-dark-primary mb-8 text-center"
          >
            {tFounder("title")}
          </motion.h2>
          <motion.blockquote
            {...fadeInUp}
            whileInView="animate"
            initial="initial"
            viewport={{ once: true }}
            transition={{ ...fadeInUp.transition, delay: 0.15 }}
            className="border-brand-accent/60 text-text-dark-strong border-l-2 pl-6 text-[16.5px] leading-[1.75] md:pl-7"
          >
            {tFounder("quote")}
          </motion.blockquote>
          {/* 署名是标签而非正文，走 mono 小标签 */}
          <motion.p
            {...fadeInUp}
            whileInView="animate"
            initial="initial"
            viewport={{ once: true }}
            transition={{ ...fadeInUp.transition, delay: 0.3 }}
            className="text-text-dark-secondary mt-6 text-right font-mono text-[10.5px] tracking-[0.12em] uppercase"
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
