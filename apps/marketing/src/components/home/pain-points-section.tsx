// @input  — next-intl, framer-motion
// @output — PainPointsSection 组件（4 张痛点卡片）
// @pos    — 首页区块 3，深色背景，SPEC 2.5.2 / Signal Console 设计规范
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";

// 编号取代图标：四张卡说的是同一类问题的四个面，图标把它们伪装成四种不同的
// 东西，而 mono 序号让它们读起来像一份清单——这正是这一段想让人感到的。
const CARDS: { id: string; titleKey: string; descKey: string }[] = [
  { id: "PAIN_01", titleKey: "card1Title", descKey: "card1Desc" },
  { id: "PAIN_02", titleKey: "card2Title", descKey: "card2Desc" },
  { id: "PAIN_03", titleKey: "card3Title", descKey: "card3Desc" },
  { id: "PAIN_04", titleKey: "card4Title", descKey: "card4Desc" },
];

export function PainPointsSection() {
  const t = useTranslations("home.painPoints");

  return (
    <section className="border-t border-brand-border bg-brand-bg py-16 md:py-22">
      <div className="max-w-content mx-auto px-6 md:px-8">
        <motion.h2
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="mx-auto mb-11 max-w-[640px] text-center text-text-dark-primary"
        >
          {t("title")}
        </motion.h2>

        <motion.div
          {...staggerContainer}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4"
        >
          {CARDS.map((card) => (
            <motion.div
              key={card.titleKey}
              {...staggerItem}
              className="rounded-card border border-brand-border-card bg-brand-panel p-[22px]"
            >
              <span className="font-mono text-[10px] tracking-[0.08em] text-text-dark-faint">
                {card.id}
              </span>
              <h3 className="mt-3 mb-2 text-[15.5px] font-semibold text-text-dark-primary">
                {t(card.titleKey)}
              </h3>
              <p className="text-[12.5px] leading-[1.6] text-text-dark-secondary">
                {t(card.descKey)}
              </p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
