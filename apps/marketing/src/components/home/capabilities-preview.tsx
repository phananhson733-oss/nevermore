// @input  — next-intl, framer-motion
// @output — CapabilitiesPreview 组件（SEO Agent / Tech Agent 双入口）
// @pos    — 首页区块 2，深色背景 / Signal Console 设计规范
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import Link from "next/link";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";
import { ScanSearch, Wrench, type LucideIcon } from "lucide-react";
import { localePath } from "@/lib/locale-path";

const CARDS: {
  icon: LucideIcon;
  titleKey: string;
  descKey: string;
  slug: string;
}[] = [
  {
    icon: ScanSearch,
    titleKey: "seoTitle",
    descKey: "seoDesc",
    slug: "seo",
  },
  {
    icon: Wrench,
    titleKey: "techTitle",
    descKey: "techDesc",
    slug: "tech",
  },
];

export function CapabilitiesPreview() {
  const t = useTranslations("home.capabilities");
  const locale = useLocale();

  return (
    <section className="border-t border-brand-border bg-brand-bg py-16 md:py-22">
      <div className="max-w-content mx-auto px-6 md:px-8">
        <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
          <div className="max-w-2xl">
            <p className="font-mono text-[10.5px] tracking-[0.14em] text-brand-accent-text uppercase">
              {t("eyebrow")}
            </p>
            <motion.h2
              initial={{ opacity: 0, y: 14 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{
                duration: 0.45,
                ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
              }}
              className="mt-3 text-text-dark-primary"
            >
              {t("title")}
            </motion.h2>
            <p className="mt-4 text-[14.5px] leading-[1.65] text-text-dark-secondary">
              {t("subtitle")}
            </p>
          </div>

          <Link
            href={localePath(locale, "/agents")}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.06em] whitespace-nowrap text-brand-accent-2 uppercase transition-colors hover:text-brand-info"
          >
            {/* 箭头靠 flex gap 与文字分开，不靠 JSX 里的空白字符：`{expr} &rarr;`
                的那个空格会被 JSX 的文本清理吃掉，箭头会紧贴最后一个字母。 */}
            {t("viewAll")}
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>

        <motion.div
          {...staggerContainer}
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          className="grid grid-cols-1 gap-4 sm:grid-cols-2"
        >
          {CARDS.map((card) => (
            <motion.div key={card.titleKey} {...staggerItem}>
              <Link
                href={localePath(locale, `/agents/${card.slug}`)}
                className="group block h-full rounded-card border border-brand-border-card bg-brand-panel p-[26px] transition-colors hover:border-brand-accent/40"
              >
                <span
                  className="flex size-[38px] items-center justify-center rounded-[10px] border border-brand-accent/25 bg-brand-accent-soft text-brand-accent"
                  aria-hidden="true"
                >
                  <card.icon className="size-[17px]" />
                </span>
                <h3 className="mt-4 text-[16.5px] font-semibold text-text-dark-primary">
                  {t(card.titleKey)}
                </h3>
                <p className="mt-2 text-[13px] leading-[1.6] text-text-dark-secondary">
                  {t(card.descKey)}
                </p>
                <span className="mt-4 flex flex-wrap gap-2">
                  <span className="rounded-md border border-brand-border-strong bg-brand-panel-raised px-2 py-1 font-mono text-[9.5px] tracking-[0.06em] text-text-dark-secondary uppercase">
                    {t("accountRequired")}
                  </span>
                  <span className="rounded-md border border-brand-border-strong bg-brand-panel-raised px-2 py-1 font-mono text-[9.5px] tracking-[0.06em] text-text-dark-secondary uppercase">
                    {t("liveCrawl")}
                  </span>
                </span>
                <span className="mt-4 inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-text uppercase transition-colors group-hover:text-brand-accent-hover">
                  {t("cardCta")}
                  <span aria-hidden="true">&rarr;</span>
                </span>
              </Link>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
