// @input  — next-intl, framer-motion
// @output — SolutionSection 组件（四步 SEO 增长工作流）
// @pos    — 首页区块 4，交替底色 / Signal Console 设计规范
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { fadeInUp, staggerContainer, staggerItem } from "@/lib/animations";

const STEPS = [
  { id: "STEP_01", labelKey: "step1", descKey: "step1Desc" },
  { id: "STEP_02", labelKey: "step2", descKey: "step2Desc" },
  { id: "STEP_03", labelKey: "step3", descKey: "step3Desc" },
  { id: "STEP_04", labelKey: "step4", descKey: "step4Desc" },
] as const;

export function SolutionSection() {
  const t = useTranslations("home.solution");

  return (
    <section className="border-t border-brand-border bg-brand-bg-alt py-16 md:py-22">
      <div className="max-w-content mx-auto px-6 md:px-8">
        <div className="mb-9 flex flex-wrap items-end justify-between gap-8">
          <motion.h2
            {...fadeInUp}
            whileInView="animate"
            initial="initial"
            viewport={{ once: true }}
            className="max-w-[520px] text-text-dark-primary"
          >
            {t("title")}
          </motion.h2>
          <motion.p
            {...fadeInUp}
            whileInView="animate"
            initial="initial"
            viewport={{ once: true }}
            transition={{ ...fadeInUp.transition, delay: 0.15 }}
            className="max-w-[400px] text-[14.5px] leading-[1.6] text-text-dark-secondary"
          >
            {t("subtitle")}
          </motion.p>
        </div>

        {/*
         * 伪表格而非四张独立卡片：这四步是一条有序链路，共享外框加 1px 分隔线能
         * 表达“同一条流水线的四段”，而卡片间距会把它们读成四个可独立选择的选项。
         */}
        <motion.div
          {...staggerContainer}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          className="grid grid-cols-1 gap-px overflow-hidden rounded-card border border-brand-border-card bg-brand-border-card sm:grid-cols-2 lg:grid-cols-4"
        >
          {STEPS.map((step, i) => (
            <motion.div
              key={step.labelKey}
              {...staggerItem}
              className={`bg-brand-bg-alt p-[26px] ${
                i === 0
                  ? "bg-[linear-gradient(180deg,rgba(61,220,151,0.06),transparent)]"
                  : ""
              }`}
            >
              <div
                className={`font-mono text-[10.5px] tracking-[0.08em] ${
                  i === 0
                    ? "text-brand-accent-text"
                    : "text-text-dark-secondary"
                }`}
              >
                {step.id}
              </div>
              <div className="mt-2.5 text-[16.5px] font-semibold text-text-dark-primary">
                {t(step.labelKey)}
              </div>
              {/*
               * 每格的说明句不是可选的装饰：没有它，四格塌成一条纯标签带，读者无从
               * 知道每一步实际做什么，这也是首页唯一点名数据源的位置。
               */}
              <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                {t(step.descKey)}
              </p>
            </motion.div>
          ))}
        </motion.div>

        <motion.p
          {...fadeInUp}
          whileInView="animate"
          initial="initial"
          viewport={{ once: true }}
          className="mt-8 border-l-2 border-brand-accent pl-4 text-[14.5px] leading-[1.7] text-text-dark-strong"
        >
          {t("definition")}
        </motion.p>
      </div>
    </section>
  );
}
