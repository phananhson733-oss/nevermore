// @input  — next-intl, next/link, framer-motion, site config, animations preset
// @output — HeroSection 组件（方法论定位 + 产品/免费工具双入口）
// @pos    — 首页区块 1，深色背景，SPEC 2.5.2
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowDownRight, ArrowRight } from "lucide-react";
import { fadeInUp } from "@/lib/animations";
import { siteConfig } from "@/config/site";

export function HeroSection() {
  const t = useTranslations("home.hero");
  const locale = useLocale();

  return (
    <section className="relative flex min-h-[74vh] items-center justify-center overflow-hidden bg-brand-bg md:min-h-[82vh]">
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

      <div className="relative mx-auto max-w-content px-4 text-center">
        <motion.p
          {...fadeInUp}
          className="mb-6 text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-accent-text"
        >
          {t("eyebrow")}
        </motion.p>
        <motion.h1
          {...fadeInUp}
          className="mx-auto mb-6 max-w-4xl font-semibold text-text-dark-primary"
        >
          {t("title")}
        </motion.h1>

        <motion.p
          {...fadeInUp}
          transition={{ ...fadeInUp.transition, delay: 0.15 }}
          className="mx-auto mb-8 max-w-2xl text-base text-text-dark-secondary md:mb-10 md:text-lg lg:text-xl"
        >
          {t("subtitle")}
        </motion.p>

        <motion.div
          {...fadeInUp}
          transition={{ ...fadeInUp.transition, delay: 0.3 }}
          className="flex flex-col items-center justify-center gap-3 sm:flex-row"
        >
          <a
            href={siteConfig.appUrl}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-accent px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          >
            {t("primaryCta")}
            <ArrowRight aria-hidden="true" className="size-4" />
          </a>
          <Link
            href={`/${locale}/tools`}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-xl border border-brand-border px-6 text-sm font-semibold text-text-dark-primary transition-colors hover:border-brand-accent/70 hover:bg-white/[0.03] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          >
            {t("secondaryCta")}
            <ArrowDownRight aria-hidden="true" className="size-4" />
          </Link>
        </motion.div>

        <motion.p
          {...fadeInUp}
          transition={{ ...fadeInUp.transition, delay: 0.45 }}
          className="mt-6 text-sm text-[#9B9690]"
        >
          {t("socialProof")}
        </motion.p>
      </div>
    </section>
  );
}
