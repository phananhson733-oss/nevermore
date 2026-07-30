// @input  — next-intl, framer-motion, animations preset
// @output — HeroSection 组件（大标题 + 副标题 + Waitlist CTA + 网格背景）
// @pos    — 首页区块 1，深色背景，SPEC 2.5.2
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { fadeInUp } from "@/lib/animations";

export function HeroSection({ onOpenTrial }: { onOpenTrial?: () => void }) {
  const t = useTranslations("home.hero");

  return (
    <section className="relative min-h-[80vh] md:min-h-[90vh] flex items-center justify-center bg-brand-bg overflow-hidden">
      {/* Grid background */}
      <div
        aria-hidden="true"
        className="absolute inset-0 opacity-[0.04]"
        style={{
          backgroundImage:
            "linear-gradient(rgba(217,119,87,0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(217,119,87,0.3) 1px, transparent 1px)",
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative max-w-content mx-auto px-4 text-center">
        <motion.h1
          {...fadeInUp}
          className="text-text-dark-primary font-semibold mb-6 max-w-4xl mx-auto"
        >
          {t("title")}
        </motion.h1>

        <motion.p
          {...fadeInUp}
          transition={{ ...fadeInUp.transition, delay: 0.15 }}
          className="text-text-dark-secondary text-base md:text-lg lg:text-xl mb-8 md:mb-10 max-w-2xl mx-auto"
        >
          {t("subtitle")}
        </motion.p>

        <motion.div
          {...fadeInUp}
          transition={{ ...fadeInUp.transition, delay: 0.3 }}
        >
          <Button
            onClick={onOpenTrial}
            size="lg"
            className="bg-brand-accent hover:bg-brand-accent-hover text-white text-base px-8 h-12"
          >
            {t("cta")}
          </Button>
        </motion.div>

        <motion.p
          {...fadeInUp}
          transition={{ ...fadeInUp.transition, delay: 0.45 }}
          className="text-sm mt-6 text-[#9B9690]"
        >
          {t("socialProof")}
        </motion.p>
      </div>
    </section>
  );
}
