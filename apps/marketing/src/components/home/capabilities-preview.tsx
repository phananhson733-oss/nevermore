// @input  — next-intl, framer-motion
// @output — CapabilitiesPreview 组件（3 张能力卡片 + 查看全部链接）
// @pos    — 首页区块 5，暖白背景，SPEC 2.5.2
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import Link from "next/link";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { Search, Brain, BarChart3, type LucideIcon } from "lucide-react";

const CARDS: { icon: LucideIcon; titleKey: string; descKey: string }[] = [
  { icon: Search, titleKey: "card1Title", descKey: "card1Desc" },
  { icon: Brain, titleKey: "card2Title", descKey: "card2Desc" },
  { icon: BarChart3, titleKey: "card3Title", descKey: "card3Desc" },
];

export function CapabilitiesPreview() {
  const t = useTranslations("home.capabilities");
  const locale = useLocale();

  return (
    <section className="bg-brand-bg-light py-16 md:py-24">
      <div className="max-w-content mx-auto px-4">
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
          className="text-text-light-primary font-semibold text-center mb-12"
        >
          {t("title")}
        </motion.h2>

        <motion.div
          {...staggerContainer}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8"
        >
          {CARDS.map((card) => (
            <motion.div
              key={card.titleKey}
              {...staggerItem}
              className="bg-white border border-gray-200 rounded-card p-6 flex gap-4"
            >
              <span className="shrink-0" aria-hidden="true"><card.icon className="size-6 text-brand-accent-on-light" /></span>
              <div>
                <h3 className="text-text-light-primary font-semibold text-base mb-1">
                  {t(card.titleKey)}
                </h3>
                <p className="text-text-light-secondary text-sm leading-relaxed">
                  {t(card.descKey)}
                </p>
              </div>
            </motion.div>
          ))}
        </motion.div>

        <div className="text-center">
          <Link
            href={`/${locale}/features`}
            className="text-brand-accent-on-light hover:text-brand-accent font-medium text-sm transition-colors"
          >
            {t("viewAll")}
          </Link>
        </div>
      </div>
    </section>
  );
}
