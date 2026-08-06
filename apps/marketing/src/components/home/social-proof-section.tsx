// @input  — next-intl, framer-motion
// @output — SocialProofSection 组件（证据优先的方法论承诺）
// @pos    — 首页区块 6，交替底色 / Signal Console 设计规范
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import Link from "next/link";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/animations";
import { localePath } from "@/lib/locale-path";

export function SocialProofSection() {
  const t = useTranslations("home.socialProof");
  const locale = useLocale();

  // 三条原则说的是同一套方法论的三个环节，编号让它们读成一个序列；换成三个
  // 互不相干的图标反而会把顺序关系抹掉。
  const principles = [
    { id: "PRINCIPLE_01", title: t("evidenceTitle"), sub: t("evidenceSub") },
    { id: "PRINCIPLE_02", title: t("sequenceTitle"), sub: t("sequenceSub") },
    { id: "PRINCIPLE_03", title: t("limitsTitle"), sub: t("limitsSub") },
  ];

  return (
    <section className="border-t border-brand-border bg-brand-bg-alt py-16 md:py-22">
      <div className="max-w-content mx-auto px-6 text-center md:px-8">
        <motion.h2
          {...fadeInUp}
          whileInView="animate"
          initial="initial"
          viewport={{ once: true }}
          className="mb-3.5 text-text-dark-primary"
        >
          {t("title")}
        </motion.h2>

        <motion.p
          {...fadeInUp}
          whileInView="animate"
          initial="initial"
          viewport={{ once: true }}
          transition={{ ...fadeInUp.transition, delay: 0.15 }}
          className="mx-auto mb-11 max-w-[600px] text-[15.5px] leading-[1.65] text-text-dark-secondary"
        >
          {t("subtitle")}
        </motion.p>

        <motion.div
          {...fadeInUp}
          whileInView="animate"
          initial="initial"
          viewport={{ once: true }}
          transition={{ ...fadeInUp.transition, delay: 0.3 }}
          className="grid grid-cols-1 gap-4 text-left md:grid-cols-3"
        >
          {principles.map((item) => (
            <div
              key={item.id}
              className="rounded-card border border-brand-border-card bg-brand-panel p-[26px] transition-colors hover:border-brand-accent/40"
            >
              <p className="font-mono text-[10px] tracking-[0.08em] text-brand-accent-text">
                {item.id}
              </p>
              <p className="mt-3 text-base font-semibold text-text-dark-primary">
                {item.title}
              </p>
              <p className="mt-2 text-[13px] leading-[1.65] text-text-dark-secondary">
                {item.sub}
              </p>
            </div>
          ))}
        </motion.div>

        <Link
          href={localePath(locale, "/blog")}
          className="mt-8 inline-block font-mono text-[11px] tracking-[0.06em] text-brand-accent-text uppercase transition-colors hover:text-brand-accent-hover"
        >
          {t("cta")}
        </Link>
      </div>
    </section>
  );
}
