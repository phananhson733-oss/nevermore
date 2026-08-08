// @input  — next-intl, framer-motion
// @output — CapabilitiesPreview 组件（按用户情境分组的免费工具入口）
// @pos    — 首页区块 5，深色背景 / Signal Console 设计规范
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import Link from "next/link";
import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";
import {
  Calculator,
  Link2,
  ScanSearch,
  TrendingDown,
  TrendingUp,
  Coins,
  type LucideIcon,
} from "lucide-react";
import { localePath } from "@/lib/locale-path";

/*
 * 分组的依据是**摩擦等级**，不是主题——访客的第一个问题是「哪个我现在就能试」。
 *
 * 早先这里只放免登录工具，理由是共享的「运行工具」CTA 会让人以为点进去就能
 * 出结果，而 GSC 工具需要先授权。那个顾虑成立，解法不是把工具藏起来：前置
 * 条件由分组承担，GSC 组的 CTA 也换成「查看使用前提」，承诺与能力对齐。
 *
 * 前置条件**只在组标题上说一次**。早前每张卡右上角还挂了一个 mono uppercase
 * 的标签，结果它和组标题同属一个视觉档、内容又重复（组说「只需要一个网址」、
 * 卡说「无需账号」），扫页时分不出哪个是分组。组标题因此改用正文字重而非
 * 标签那一档——它是分隔符，不是又一个 chip。
 *
 * 组标题只写**结构性**前置条件（要不要连 GSC），不写同意屏的审核状态——那是
 * 运行时 env 决定的三态（未开 / invite_only / unverified），会漂移，由各工具页
 * 自己的 connect panel 如实呈现。
 *
 * hidden-keywords 不列入：它是 noIndex 的产品连接页，不是公开工具。
 */
type ToolCard = {
  icon: LucideIcon;
  titleKey: string;
  descKey: string;
  slug: string;
};

const GROUPS: {
  labelKey: string;
  ctaKey: string;
  cards: ToolCard[];
}[] = [
  {
    labelKey: "groupUrl",
    ctaKey: "cardCta",
    cards: [
      {
        icon: ScanSearch,
        titleKey: "auditTitle",
        descKey: "auditDesc",
        slug: "seo-audit",
      },
      {
        icon: Link2,
        titleKey: "linksTitle",
        descKey: "linksDesc",
        slug: "internal-link-audit",
      },
    ],
  },
  {
    labelKey: "groupCalculators",
    ctaKey: "cardCta",
    cards: [
      {
        icon: Calculator,
        titleKey: "abTestTitle",
        descKey: "abTestDesc",
        slug: "ab-test-calculator",
      },
      {
        icon: Coins,
        titleKey: "roiTitle",
        descKey: "roiDesc",
        slug: "growth-roi-calculator",
      },
    ],
  },
  {
    labelKey: "groupGsc",
    ctaKey: "cardCtaGsc",
    cards: [
      {
        icon: TrendingUp,
        titleKey: "quickWinsTitle",
        descKey: "quickWinsDesc",
        slug: "seo-quick-wins",
      },
      {
        icon: TrendingDown,
        titleKey: "trafficDropTitle",
        descKey: "trafficDropDesc",
        slug: "traffic-drop-diagnosis",
      },
    ],
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
            href={localePath(locale, "/tools")}
            className="inline-flex items-center gap-1.5 font-mono text-[11px] tracking-[0.06em] whitespace-nowrap text-brand-accent-2 uppercase transition-colors hover:text-brand-info"
          >
            {/* 箭头靠 flex gap 与文字分开，不靠 JSX 里的空白字符：`{expr} &rarr;`
                的那个空格会被 JSX 的文本清理吃掉，箭头会紧贴最后一个字母。 */}
            {t("viewAll")}
            <span aria-hidden="true">&rarr;</span>
          </Link>
        </div>

        <div className="space-y-9">
          {GROUPS.map((group) => (
            <div key={group.labelKey}>
              <h3 className="mb-3.5 text-[13.5px] font-semibold text-text-dark-primary">
                {t(group.labelKey)}
              </h3>
              <motion.div
                {...staggerContainer}
                initial="initial"
                whileInView="animate"
                viewport={{ once: true }}
                className="grid grid-cols-1 gap-4 sm:grid-cols-2"
              >
                {group.cards.map((card) => (
                  <motion.div key={card.titleKey} {...staggerItem}>
                    <Link
                      href={localePath(locale, `/tools/${card.slug}`)}
                      className="group block h-full rounded-card border border-brand-border-card bg-brand-panel p-[26px] transition-colors hover:border-brand-accent/40"
                    >
                      <span
                        className="flex size-[38px] items-center justify-center rounded-[10px] border border-brand-accent/25 bg-brand-accent-soft text-brand-accent"
                        aria-hidden="true"
                      >
                        <card.icon className="size-[17px]" />
                      </span>
                      <h4 className="mt-4 text-[16.5px] font-semibold text-text-dark-primary">
                        {t(card.titleKey)}
                      </h4>
                      <p className="mt-2 text-[13px] leading-[1.6] text-text-dark-secondary">
                        {t(card.descKey)}
                      </p>
                      <span className="mt-4 inline-flex items-center gap-1.5 font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-text uppercase transition-colors group-hover:text-brand-accent-hover">
                        {t(group.ctaKey)}
                        <span aria-hidden="true">&rarr;</span>
                      </span>
                    </Link>
                  </motion.div>
                ))}
              </motion.div>
            </div>
          ))}
        </div>

        <p className="mt-9 max-w-3xl border-t border-brand-border pt-6 text-[13px] leading-[1.7] text-text-dark-secondary">
          {t("gscNote")}
        </p>
      </div>
    </section>
  );
}
