// @input  -- next-intl, next/link, framer-motion, site config
// @output -- pricing-positioning page without unapproved plans or price claims
// @pos    -- pricing route's client presentation layer
"use client";

import Link from "next/link";
import { ArrowRight, Check } from "lucide-react";
import { motion } from "framer-motion";
import { useLocale, useTranslations } from "next-intl";
import { siteConfig } from "@/config/site";
import { fadeInUp } from "@/lib/animations";
import { PricingFaq } from "./pricing-faq";
import { localePath } from "@/lib/locale-path";

const FREE_TOOL_ITEMS = ["item1", "item2", "item3"] as const;

export default function PricingPageClient() {
  const locale = useLocale();
  const tHero = useTranslations("pricing.hero");
  const tFree = useTranslations("pricing.freeTools");
  const tProduct = useTranslations("pricing.product");
  const tCta = useTranslations("pricing.cta");

  return (
    /* PageShell 已经为 fixed 导航垫了 68px，根容器不再补顶部间距 */
    <div className="min-h-screen bg-brand-bg pb-24">
      <section className="relative overflow-hidden border-b border-brand-border pt-16 pb-14 md:pt-21 md:pb-18">
        {/* GLOW_01 — 页级 hero 才允许的网格 + 氛围光 */}
        <div
          aria-hidden="true"
          className="bg-signal-grid absolute inset-0 opacity-40"
        />
        <div
          aria-hidden="true"
          className="absolute -top-45 left-1/2 hidden h-100 w-150 -translate-x-1/2 rounded-full bg-[radial-gradient(ellipse,rgba(61,220,151,0.14),transparent_65%)] blur-[12px] md:block"
        />
        <div className="max-w-content relative mx-auto px-6 text-center md:px-8">
          <motion.p
            {...fadeInUp}
            className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase"
          >
            {tHero("eyebrow")}
          </motion.p>
          <motion.h1
            {...fadeInUp}
            transition={{ ...fadeInUp.transition, delay: 0.1 }}
            className="mx-auto mt-5 max-w-3xl text-text-dark-primary"
          >
            {tHero("title")}
          </motion.h1>
          <motion.p
            {...fadeInUp}
            transition={{ ...fadeInUp.transition, delay: 0.2 }}
            className="mx-auto mt-5 max-w-2xl text-[15.5px] leading-[1.65] text-text-dark-secondary md:text-[17px]"
          >
            {tHero("subtitle")}
          </motion.p>
        </div>
      </section>

      <section className="py-16 md:py-22">
        <div className="max-w-content mx-auto grid gap-4 px-6 md:px-8 lg:grid-cols-2">
          {/* 强调卡：免费工具是当前唯一可立即使用的入口 */}
          <article className="rounded-card border border-brand-accent/50 bg-brand-accent/[0.08] p-[26px] shadow-[inset_2px_0_0_#3DDC97] md:p-8">
            <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
              {tFree("eyebrow")}
            </p>
            <h2 className="mt-4 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
              {tFree("title")}
            </h2>
            <p className="mt-3 max-w-lg text-[13px] leading-[1.65] text-text-dark-secondary">
              {tFree("body")}
            </p>
            <ul className="mt-7 space-y-3">
              {FREE_TOOL_ITEMS.map((item) => (
                <li
                  key={item}
                  className="flex gap-2.5 text-[13px] leading-[1.6] text-text-dark-strong"
                >
                  <Check
                    aria-hidden="true"
                    className="mt-[3px] size-[15px] shrink-0 text-brand-accent"
                  />
                  {tFree(item)}
                </li>
              ))}
            </ul>
            {/* GLOW_02 — 本屏唯一的渐变主 CTA */}
            <Link
              href={localePath(locale, "/tools")}
              className="mt-7 inline-flex h-11.5 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-6 text-[14px] font-semibold text-brand-on-accent shadow-cta-sm transition-shadow hover:shadow-cta focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
            >
              {tFree("cta")}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </article>

          <article className="rounded-card border border-brand-border-card bg-brand-panel p-[26px] md:p-8">
            <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
              {tProduct("eyebrow")}
            </p>
            <h2 className="mt-4 text-[25px] font-semibold tracking-[-0.03em] text-text-dark-primary">
              {tProduct("title")}
            </h2>
            <p className="mt-3 max-w-lg text-[13px] leading-[1.65] text-text-dark-secondary">
              {tProduct("body")}
            </p>
            <div className="mt-7 border-l-2 border-brand-accent pl-4">
              <p className="text-[13px] leading-[1.6] font-medium text-text-dark-primary">
                {tProduct("principle")}
              </p>
              <p className="mt-2 text-[12.5px] leading-[1.6] text-text-dark-secondary">
                {tProduct("principleBody")}
              </p>
            </div>
            <a
              href={siteConfig.appUrl}
              className="mt-7 inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-text uppercase transition-colors hover:text-brand-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
            >
              {tProduct("cta")}
              <ArrowRight aria-hidden="true" className="size-3.5" />
            </a>
          </article>
        </div>
      </section>

      <section className="border-y border-brand-border bg-brand-bg-alt py-16 md:py-22">
        <div className="max-w-content mx-auto px-6 md:px-8">
          <PricingFaq />
        </div>
      </section>

      <section className="relative overflow-hidden py-16 md:py-22">
        {/* GLOW_03 — 底部 CTA 地平线光，本屏唯一光效 */}
        <div
          aria-hidden="true"
          className="absolute inset-x-0 -bottom-40 mx-auto h-80 w-[680px] rounded-full bg-[radial-gradient(ellipse,rgba(61,220,151,0.12),transparent_65%)] blur-[12px]"
        />
        <div className="max-w-content relative mx-auto px-6 text-center md:px-8">
          <motion.h2
            {...fadeInUp}
            whileInView="animate"
            initial="initial"
            viewport={{ once: true }}
            className="text-text-dark-primary"
          >
            {tCta("title")}
          </motion.h2>
          <motion.p
            {...fadeInUp}
            whileInView="animate"
            initial="initial"
            viewport={{ once: true }}
            transition={{ ...fadeInUp.transition, delay: 0.15 }}
            className="mx-auto mt-4 max-w-2xl text-[15.5px] leading-[1.65] text-text-dark-secondary"
          >
            {tCta("subtitle")}
          </motion.p>
          <motion.div
            {...fadeInUp}
            whileInView="animate"
            initial="initial"
            viewport={{ once: true }}
            transition={{ ...fadeInUp.transition, delay: 0.3 }}
          >
            {/* GLOW_02 — 一屏最多一个渐变主 CTA */}
            <Link
              href={localePath(locale, "/tools")}
              className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-[10px] bg-brand-gradient px-[26px] text-[14.5px] font-semibold text-brand-on-accent shadow-cta transition-shadow hover:shadow-cta-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
            >
              {tCta("button")}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </motion.div>
        </div>
      </section>
    </div>
  );
}
