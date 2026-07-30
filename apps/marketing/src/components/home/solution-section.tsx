// @input  — next-intl, framer-motion
// @output — SolutionSection 组件（四步 SEO 增长工作流）
// @pos    — 首页区块 4，深色背景，SPEC 2.5.2
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { fadeInUp, staggerContainer, staggerItem } from "@/lib/animations";
import {
  FileText,
  Search,
  Network,
  Waypoints,
  type LucideIcon,
} from "lucide-react";

const STEPS: { icon: LucideIcon; labelKey: string }[] = [
  { icon: FileText, labelKey: "step1" },
  { icon: Search, labelKey: "step2" },
  { icon: Network, labelKey: "step3" },
  { icon: Waypoints, labelKey: "step4" },
];

export function SolutionSection() {
  const t = useTranslations("home.solution");

  return (
    <section className="bg-brand-bg py-16 md:py-24">
      <div className="max-w-content mx-auto px-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          {/* Left: text */}
          <div>
            <motion.p
              {...fadeInUp}
              whileInView="animate"
              initial="initial"
              viewport={{ once: true }}
              className="border-l-2 border-brand-accent pl-4 text-lg font-bold text-text-dark-primary mb-6"
            >
              {t("definition")}
            </motion.p>
            <motion.h2
              {...fadeInUp}
              whileInView="animate"
              initial="initial"
              viewport={{ once: true }}
              className="text-text-dark-primary font-semibold mb-4"
            >
              {t("title")}
            </motion.h2>
            <motion.p
              {...fadeInUp}
              whileInView="animate"
              initial="initial"
              viewport={{ once: true }}
              transition={{ ...fadeInUp.transition, delay: 0.15 }}
              className="text-text-dark-secondary text-lg"
            >
              {t("subtitle")}
            </motion.p>
          </div>

          {/* Right: flow chart */}
          <motion.div
            {...staggerContainer}
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-4"
          >
            {STEPS.map((step, i) => (
              <motion.div
                key={step.labelKey}
                {...staggerItem}
                className="relative flex flex-col items-center gap-2"
              >
                <div className="flex flex-col items-center gap-2">
                  <div
                    className={`${
                      i === 0
                        ? "bg-brand-accent text-white"
                        : "border-2 border-brand-accent text-text-dark-primary"
                    } rounded-full size-16 flex items-center justify-center text-xl shrink-0`}
                  >
                    <step.icon className="size-5" aria-hidden="true" />
                  </div>
                  <p className="text-text-dark-secondary text-xs text-center whitespace-nowrap">
                    {t(step.labelKey)}
                  </p>
                </div>
                {i < STEPS.length - 1 && (
                  <div className="absolute left-[calc(50%+2.25rem)] top-8 hidden w-[calc(100%-3.5rem)] border-t border-dashed border-brand-accent/60 sm:block" />
                )}
              </motion.div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  );
}
