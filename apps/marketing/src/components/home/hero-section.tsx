// @input  — next-intl, next/link, framer-motion, site config, animations preset
// @output — HeroSection 组件（方法论定位 + 产品/免费工具双入口）
// @pos    — 首页区块 1，深色背景，SPEC 2.5.2 / Signal Console 设计规范
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight } from "lucide-react";
import { fadeInUp } from "@/lib/animations";
import { siteConfig } from "@/config/site";
import { localePath } from "@/lib/locale-path";

export function HeroSection() {
  const t = useTranslations("home.hero");
  const locale = useLocale();

  return (
    <section className="relative overflow-hidden bg-brand-bg">
      {/* GLOW_01 — 48px 网格线 + 双色氛围光，全站仅首屏与页级 hero 出现 */}
      <div
        aria-hidden="true"
        className="bg-signal-grid absolute inset-0 opacity-45"
      />
      <div
        aria-hidden="true"
        className="absolute -top-55 left-[12%] h-115 w-160 rounded-full bg-[radial-gradient(ellipse,rgba(61,220,151,0.16),transparent_65%)] blur-[12px]"
      />
      <div
        aria-hidden="true"
        className="absolute -top-40 right-[6%] h-105 w-140 rounded-full bg-[radial-gradient(ellipse,rgba(76,195,250,0.12),transparent_65%)] blur-[12px]"
      />

      <div className="max-w-content relative mx-auto px-6 pt-21 text-center md:px-8">
        <motion.p
          {...fadeInUp}
          className="inline-flex items-center gap-2.5 rounded-md border border-brand-accent/25 bg-brand-accent/[0.06] px-3.5 py-[7px] font-mono text-[11.5px] tracking-[0.14em] text-brand-accent-text uppercase shadow-[0_0_24px_rgba(61,220,151,0.12)]"
        >
          <span
            aria-hidden="true"
            className="animate-subtle-pulse size-1.5 rounded-full bg-brand-accent shadow-[0_0_8px_rgba(61,220,151,0.9)]"
          />
          {t("eyebrow")}
        </motion.p>

        <motion.h1
          {...fadeInUp}
          className="mx-auto mt-7 max-w-[880px] text-text-dark-primary"
        >
          {t.rich("title", {
            hl: (chunks) => (
              <span className="text-brand-gradient">{chunks}</span>
            ),
          })}
        </motion.h1>

        <motion.p
          {...fadeInUp}
          transition={{ ...fadeInUp.transition, delay: 0.15 }}
          className="mx-auto mt-5.5 max-w-[640px] text-[17.5px] leading-[1.65] text-text-dark-secondary"
        >
          {t("subtitle")}
        </motion.p>

        <motion.div
          {...fadeInUp}
          transition={{ ...fadeInUp.transition, delay: 0.3 }}
          className="mt-8.5 flex flex-col items-center justify-center gap-3.5 sm:flex-row"
        >
          {/* GLOW_02 — 一屏最多一个渐变主 CTA，次按钮靠描边分层，不带投影 */}
          <a
            href={siteConfig.appUrl}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-[26px] text-[14.5px] font-semibold text-brand-on-accent shadow-cta transition-shadow hover:shadow-cta-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          >
            {t("primaryCta")}
            <ArrowRight aria-hidden="true" className="size-[15px]" />
          </a>
          <Link
            href={localePath(locale, "/tools")}
            className="inline-flex h-12 items-center justify-center rounded-[10px] border border-brand-border-strong bg-brand-panel/60 px-6 text-[14.5px] font-medium text-text-dark-primary transition-colors hover:border-brand-accent/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
          >
            {t("secondaryCta")}
          </Link>
        </motion.div>

        {/*
         * 这是一句完整的正文，不是标签——mono + uppercase + faint 那一档留给
         * 编号和 chip。11px 的 faint 在页面底上只有 3.5:1，读不动。
         */}
        <motion.p
          {...fadeInUp}
          transition={{ ...fadeInUp.transition, delay: 0.45 }}
          className="mt-5 text-[13px] leading-[1.6] text-text-dark-secondary"
        >
          {t("socialProof")}
        </motion.p>

        {/*
         * 实体定义句：写给 AI 答案引擎的，不是写给人的。它们从 H1 那种口号里
         * 提取不出「这是什么」，需要一句主语是品牌名、说清品类的完整定义。
         * 必须是正文真实文本——AI 引擎主要读正文，只放进 schema 拿不到。
         * 视觉上可以淡，但不能做成 11px faint 那一档（对比度读不动）。
         */}
        <motion.p
          {...fadeInUp}
          transition={{ ...fadeInUp.transition, delay: 0.55 }}
          className="mx-auto mt-8 max-w-[680px] border-t border-brand-border pt-6 pb-22 text-[13.5px] leading-[1.7] text-text-dark-secondary"
        >
          {t("entityDefinition")}
        </motion.p>
      </div>
    </section>
  );
}
