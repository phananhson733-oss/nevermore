// @input  — next-intl, framer-motion, ui/button
// @output — BottomCtaSection 组件（底部转化区块）
// @pos    — 首页区块 7，深色背景，SPEC 2.5.2
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { fadeInUp } from "@/lib/animations";

export function BottomCtaSection({
  onOpenWaitlist,
}: {
  onOpenWaitlist?: () => void;
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
          <Button
            onClick={onOpenWaitlist}
            size="lg"
            className="bg-brand-accent hover:bg-brand-accent-hover text-white text-base px-8 h-12"
          >
            {t("cta")}
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
