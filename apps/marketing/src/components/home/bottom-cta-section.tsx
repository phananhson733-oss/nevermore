// @input  — next-intl, framer-motion, site config
// @output — BottomCtaSection 组件（进入已登录产品的底部转化区块）
// @pos    — 首页区块 7，深色背景
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/animations";
import { siteConfig } from "@/config/site";
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
        className="absolute -bottom-45 left-1/2 h-95 w-190 -translate-x-1/2 bg-[radial-gradient(ellipse,rgba(61,220,151,0.22),rgba(76,195,250,0.1)_60%,transparent_75%)] blur-[8px]"
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
          <a
            href={siteConfig.appUrl}
            className="inline-flex h-12.5 items-center justify-center rounded-[10px] bg-brand-gradient px-7.5 text-[15px] font-semibold text-brand-on-accent shadow-cta transition-shadow hover:shadow-cta-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          >
            {t("cta")}
          </a>
        </motion.div>

        {/*
         * 定价摘要不单独占一个区块——主页要保持视觉密度低。这里只说清免费的
         * 边界（有上限，且上限是公开的）和将来在哪收费，具体数字留给 /pricing。
         */}
        <motion.p
          {...fadeInUp}
          whileInView="animate"
          initial="initial"
          viewport={{ once: true }}
          transition={{ ...fadeInUp.transition, delay: 0.45 }}
          className="mx-auto mt-10 max-w-[640px] border-t border-brand-border pt-6 text-[12.5px] leading-[1.7] text-text-dark-secondary"
        >
          {t("pricingNote")}{" "}
          <Link
            href={localePath(locale, "/pricing")}
            className="whitespace-nowrap text-brand-accent-text underline-offset-4 transition-colors hover:text-brand-accent-hover hover:underline"
          >
            {t("pricingLink")} &rarr;
          </Link>
        </motion.p>
      </div>
    </section>
  );
}
