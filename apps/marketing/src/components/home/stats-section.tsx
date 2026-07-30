// @input  — next-intl
// @output — StatsSection 组件（3 个数字高光卡片）
// @pos    — 首页区块 2，深色背景，SPEC 2.5.2
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";

const STATS = [
  { numberKey: "stat1Number", labelKey: "stat1Label" },
  { numberKey: "stat2Number", labelKey: "stat2Label" },
  { numberKey: "stat3Number", labelKey: "stat3Label" },
] as const;

export function StatsSection() {
  const t = useTranslations("home.stats");

  return (
    <section className="bg-brand-bg-alt py-12 md:py-16">
      <motion.div
        {...staggerContainer}
        initial="initial"
        whileInView="animate"
        viewport={{ once: true }}
        className="max-w-content mx-auto px-4"
      >
        <div className="grid grid-cols-1 md:grid-cols-3 divide-y md:divide-y-0 md:divide-x divide-brand-border">
          {STATS.map((stat) => (
            <motion.div
              key={stat.numberKey}
              {...staggerItem}
              className="text-center py-6 md:py-0 md:px-8"
            >
              <p className="text-brand-accent text-4xl sm:text-5xl md:text-6xl font-bold mb-2">
                {t(stat.numberKey)}
              </p>
              <p className="text-text-dark-secondary text-sm">
                {t(stat.labelKey)}
              </p>
            </motion.div>
          ))}
        </div>
      </motion.div>
    </section>
  );
}
