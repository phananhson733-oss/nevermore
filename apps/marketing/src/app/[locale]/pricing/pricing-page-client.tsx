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

const FREE_TOOL_ITEMS = ["item1", "item2", "item3"] as const;

export default function PricingPageClient() {
  const locale = useLocale();
  const tHero = useTranslations("pricing.hero");
  const tFree = useTranslations("pricing.freeTools");
  const tProduct = useTranslations("pricing.product");
  const tCta = useTranslations("pricing.cta");

  return (
    <div className="min-h-screen bg-brand-bg pb-24 pt-16">
      <section className="border-b border-brand-border/60 py-16 md:py-24">
        <div className="mx-auto max-w-content px-4 text-center">
          <motion.p
            {...fadeInUp}
            className="text-[10px] font-semibold uppercase tracking-[0.2em] text-brand-accent-text"
          >
            {tHero("eyebrow")}
          </motion.p>
          <motion.h1
            {...fadeInUp}
            transition={{ ...fadeInUp.transition, delay: 0.1 }}
            className="mx-auto mt-4 max-w-3xl font-semibold text-text-dark-primary"
          >
            {tHero("title")}
          </motion.h1>
          <motion.p
            {...fadeInUp}
            transition={{ ...fadeInUp.transition, delay: 0.2 }}
            className="mx-auto mt-5 max-w-2xl text-lg text-text-dark-secondary"
          >
            {tHero("subtitle")}
          </motion.p>
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="mx-auto grid max-w-content gap-6 px-4 lg:grid-cols-2">
          <article className="rounded-3xl border border-brand-accent/30 bg-brand-accent/[0.055] p-7 md:p-9">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-accent-text">
              {tFree("eyebrow")}
            </p>
            <h2 className="mt-4 text-[28px] font-semibold tracking-[-0.035em] text-text-dark-primary">
              {tFree("title")}
            </h2>
            <p className="mt-4 max-w-lg text-[14px] leading-relaxed text-text-dark-secondary">
              {tFree("body")}
            </p>
            <ul className="mt-8 space-y-4">
              {FREE_TOOL_ITEMS.map((item) => (
                <li key={item} className="flex gap-3 text-[13px] leading-relaxed text-text-dark-secondary">
                  <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-brand-accent-text" />
                  {tFree(item)}
                </li>
              ))}
            </ul>
            <Link
              href={`/${locale}/tools`}
              className="mt-9 inline-flex items-center gap-2 rounded-xl bg-brand-accent px-5 py-3 text-[13px] font-semibold text-white transition-colors hover:bg-brand-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
            >
              {tFree("cta")}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </article>

          <article className="rounded-3xl border border-brand-border/70 bg-brand-bg-alt/50 p-7 md:p-9">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-accent-text">
              {tProduct("eyebrow")}
            </p>
            <h2 className="mt-4 text-[28px] font-semibold tracking-[-0.035em] text-text-dark-primary">
              {tProduct("title")}
            </h2>
            <p className="mt-4 max-w-lg text-[14px] leading-relaxed text-text-dark-secondary">
              {tProduct("body")}
            </p>
            <div className="mt-8 border-l-2 border-brand-accent/60 pl-4">
              <p className="text-[12px] font-medium leading-relaxed text-text-dark-primary">
                {tProduct("principle")}
              </p>
              <p className="mt-2 text-[12px] leading-relaxed text-text-dark-secondary">
                {tProduct("principleBody")}
              </p>
            </div>
            <a
              href={siteConfig.appUrl}
              className="mt-9 inline-flex items-center gap-2 text-[13px] font-semibold text-brand-accent-text transition-colors hover:text-brand-accent-hover"
            >
              {tProduct("cta")}
              <ArrowRight aria-hidden="true" className="size-4" />
            </a>
          </article>
        </div>
      </section>

      <section className="border-y border-brand-border/60 bg-brand-bg-alt py-16 md:py-20">
        <div className="mx-auto max-w-content px-4">
          <PricingFaq />
        </div>
      </section>

      <section className="py-16 md:py-20">
        <div className="mx-auto max-w-content px-4 text-center">
          <motion.h2
            {...fadeInUp}
            whileInView="animate"
            initial="initial"
            viewport={{ once: true }}
            className="font-semibold text-text-dark-primary"
          >
            {tCta("title")}
          </motion.h2>
          <motion.p
            {...fadeInUp}
            whileInView="animate"
            initial="initial"
            viewport={{ once: true }}
            transition={{ ...fadeInUp.transition, delay: 0.15 }}
            className="mx-auto mt-4 max-w-2xl text-lg text-text-dark-secondary"
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
            <Link
              href={`/${locale}/tools`}
              className="mt-8 inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-brand-accent px-8 text-base font-semibold text-white transition-colors hover:bg-brand-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
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
