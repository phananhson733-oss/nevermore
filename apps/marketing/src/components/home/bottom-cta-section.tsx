// @input  — next-intl, framer-motion, site config
// @output — BottomCtaSection 组件（进入已登录产品的底部转化区块）
// @pos    — 首页区块 7，深色背景
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/animations";
import { siteConfig } from "@/config/site";

export function BottomCtaSection({
  onOpenWaitlist: _onOpenWaitlist,
}: {
  readonly onOpenWaitlist?: () => void;
}) {
  const t = useTranslations("home.bottomCta");

  return (
    <section className="bg-brand-bg-alt py-16 md:py-24">
      <div className="max-w-content mx-auto px-4 text-center">
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
          className="text-text-dark-secondary text-lg max-w-2xl mx-auto mb-10"
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
            className="inline-flex h-12 items-center justify-center rounded-xl bg-brand-accent px-8 text-base font-semibold text-white transition-colors hover:bg-brand-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          >
            {t("cta")}
          </a>
        </motion.div>
      </div>
    </section>
  );
}
