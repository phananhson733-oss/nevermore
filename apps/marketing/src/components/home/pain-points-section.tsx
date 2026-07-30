// @input  — next-intl, framer-motion
// @output — PainPointsSection 组件（4 张痛点卡片）
// @pos    — 首页区块 3，暖白背景，SPEC 2.5.2
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Clock, BarChart3, Brain, Repeat, type LucideIcon } from "lucide-react";

const CARDS: { icon: LucideIcon; titleKey: string; descKey: string }[] = [
  { icon: Clock, titleKey: "card1Title", descKey: "card1Desc" },
  { icon: BarChart3, titleKey: "card2Title", descKey: "card2Desc" },
  { icon: Brain, titleKey: "card3Title", descKey: "card3Desc" },
  { icon: Repeat, titleKey: "card4Title", descKey: "card4Desc" },
];

export function PainPointsSection() {
  const t = useTranslations("home.painPoints");

  return (
    <section className="bg-brand-bg-light py-16 md:py-24">
      <div className="max-w-content mx-auto px-4">
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
          className="text-text-light-primary font-semibold text-center mb-12"
        >
          {t("title")}
        </motion.h2>

        <motion.div
          {...staggerContainer}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6"
        >
          {CARDS.map((card) => (
            <motion.div
              key={card.titleKey}
              {...staggerItem}
              className="bg-white border border-gray-200 rounded-card p-6"
            >
              <span className="mb-3 block" aria-hidden="true"><card.icon className="size-6 text-brand-accent-on-light" /></span>
              <h3 className="text-text-light-primary font-semibold text-base mb-2">
                {t(card.titleKey)}
              </h3>
              <p className="text-text-light-secondary text-sm leading-relaxed">
                {t(card.descKey)}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
