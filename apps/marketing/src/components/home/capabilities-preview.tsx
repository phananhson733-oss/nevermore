// @input  — next-intl, framer-motion
// @output — CapabilitiesPreview 组件（按用户情境分组的免费工具入口）
// @pos    — 首页区块 5，暖白背景
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import Link from "next/link";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { ArrowRight, Link2, ScanSearch, type LucideIcon } from "lucide-react";

const CARDS: { icon: LucideIcon; titleKey: string; descKey: string; slug: string }[] = [
  { icon: ScanSearch, titleKey: "auditTitle", descKey: "auditDesc", slug: "seo-audit" },
  { icon: Link2, titleKey: "linksTitle", descKey: "linksDesc", slug: "internal-link-audit" },
];

export function CapabilitiesPreview() {
  const t = useTranslations("home.capabilities");
  const locale = useLocale();

  return (
    <section className="bg-brand-bg-light py-16 md:py-24">
      <div className="max-w-content mx-auto px-4">
        <p className="mb-3 text-center text-[10px] font-semibold uppercase tracking-[0.18em] text-brand-accent-on-light">
          {t("eyebrow")}
        </p>
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] as [number, number, number, number] }}
          className="mb-4 text-center font-semibold text-text-light-primary"
        >
          {t("title")}
        </motion.h2>

        <p className="mx-auto mb-10 max-w-2xl text-center text-base text-text-light-secondary">
          {t("subtitle")}
        </p>
        <motion.div
          {...staggerContainer}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          className="mx-auto mb-8 grid max-w-4xl grid-cols-1 gap-6 md:grid-cols-2"
        >
          {CARDS.map((card) => (
            <motion.div
              key={card.titleKey}
              {...staggerItem}
              className="group flex gap-4 rounded-card border border-gray-200 bg-white p-6 transition-all hover:-translate-y-1 hover:border-brand-accent/50 hover:shadow-lg"
            >
              <span className="shrink-0" aria-hidden="true"><card.icon className="size-6 text-brand-accent-on-light" /></span>
              <div>
                <h3 className="text-text-light-primary font-semibold text-base mb-1">
                  {t(card.titleKey)}
                </h3>
                <p className="text-text-light-secondary text-sm leading-relaxed">
                  {t(card.descKey)}
                </p>
                <Link
                  href={`/${locale}/tools/${card.slug}`}
                  className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-brand-accent-on-light"
                >
                  {t("cardCta")}
                  <ArrowRight aria-hidden="true" className="size-3.5 transition-transform group-hover:translate-x-0.5" />
                </Link>
              </div>
            </motion.div>
          ))}
        </motion.div>

        <div className="text-center">
          <Link
            href={`/${locale}/tools`}
            className="text-brand-accent-on-light hover:text-brand-accent font-medium text-sm transition-colors"
          >
            {t("viewAll")}
          </Link>
        </div>
      </div>
    </section>
  );
}
