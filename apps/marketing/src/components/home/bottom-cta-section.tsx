// @input  — next-intl、framer-motion、localePath
// @output — BottomCtaSection 组件（进入 SEO Agent 的底部转化区块）
// @pos    — 首页区块 7，深色背景
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/animations";
import { localePath } from "@/lib/locale-path";

export function BottomCtaSection({
  onOpenWaitlist: _onOpenWaitlist,
}: {
  readonly onOpenWaitlist?: () => void;
}) {
  const t = useTranslations("home.bottomCta");
  const locale = useLocale();

  return (
    <section className="relative overflow-hidden border-t border-brand-border bg-brand-bg-alt py-20 md:py-25">
      {/* GLOW_03 — 底部 CTA 地平线光，全站三处光效的最后一处 */}
      <div
        aria-hidden="true"
        className="absolute -bottom-45 left-1/2 h-95 w-190 -translate-x-1/2 bg-cta-glow blur-[8px]"
      />
      <div className="max-w-content relative mx-auto px-6 text-center md:px-8">
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
          className="mx-auto mb-7.5 max-w-[540px] text-[15.5px] leading-[1.6] text-text-dark-secondary"
        >
          {t("subtitle")}
        </motion.p>

        <motion.div
          {...fadeInUp}
          whileInView="animate"
          initial="initial"
          viewport={{ once: true }}
          transition={{ ...fadeInUp.transition, delay: 0.3 }}
        >
          <Link
            href={localePath(locale, "/agents/seo")}
            className="inline-flex h-12.5 items-center justify-center rounded-[10px] bg-brand-gradient px-7.5 text-[15px] font-semibold text-brand-on-accent shadow-cta transition-shadow hover:shadow-cta-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          >
            {t("cta")}
          </Link>
        </motion.div>
      </div>
    </section>
  );
}
