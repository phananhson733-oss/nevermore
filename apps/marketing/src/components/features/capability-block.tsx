// @input  — next-intl, framer-motion, next/link, onCtaClick callback, pillarSlug
// @output — CapabilityBlock 可复用能力区块组件（文字+特性列表+How it works+CTA+Related reading+FAQ）
// @pos    — Features 页核心区块组件，SPEC 2.6.2
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations, useLocale } from "next-intl";
import { motion } from "framer-motion";
import { Check } from "lucide-react";
import { fadeInUp } from "@/lib/animations";
import Link from "next/link";
import { localePath } from "@/lib/locale-path";

interface CapabilityBlockProps {
  ns: string;
  features: string[];
  isDark: boolean;
  reverse?: boolean;
  visual?: React.ReactNode;
  onCtaClick?: () => void;
  pillarSlug?: string;
}

export function CapabilityBlock({
  ns,
  features,
  isDark,
  reverse = false,
  visual,
  onCtaClick,
  pillarSlug,
}: CapabilityBlockProps) {
  const t = useTranslations(`features.${ns}`);
  const locale = useLocale();

  // Signal Console 全站深色：相邻区块靠 bg / bg-alt 交替加 1px 分隔线分段，
  // 不再翻转前景色，所以文字与描边在两种底色下都是同一套 token。
  const bgClass = isDark ? "bg-brand-bg" : "bg-brand-bg-alt";
  const titleClass = "text-text-dark-primary";
  const descClass = "text-text-dark-secondary";
  const cardBg = "border-brand-border-card";
  const faqBg = isDark
    ? "bg-brand-panel border-brand-border-card"
    : "bg-brand-panel-raised border-brand-border-card";

  return (
    <section
      className={`${bgClass} border-t border-brand-border py-16 md:py-22`}
    >
      <div className="max-w-content mx-auto px-6 md:px-8">
        <div className="grid grid-cols-1 items-start gap-10 lg:grid-cols-2 lg:gap-14">
          {/* Text side */}
          <div className={reverse ? "lg:order-2" : ""}>
            <motion.h2
              {...fadeInUp}
              whileInView="animate"
              initial="initial"
              viewport={{ once: true }}
              className={titleClass}
            >
              {t("title")}
            </motion.h2>
            <motion.p
              {...fadeInUp}
              whileInView="animate"
              initial="initial"
              viewport={{ once: true }}
              transition={{ ...fadeInUp.transition, delay: 0.1 }}
              className={`${descClass} mt-4 mb-7 text-[15.5px] leading-[1.65]`}
            >
              {t("desc")}
            </motion.p>

            {/* Feature list */}
            <ul className="space-y-2.5">
              {features.map((fKey) => (
                <motion.li
                  key={fKey}
                  {...fadeInUp}
                  whileInView="animate"
                  initial="initial"
                  viewport={{ once: true }}
                  className={`${descClass} flex items-start gap-2.5 text-[13px] leading-[1.6]`}
                >
                  <Check
                    className="mt-[3px] size-[13px] shrink-0 text-brand-accent"
                    aria-hidden="true"
                  />
                  {t(fKey)}
                </motion.li>
              ))}
            </ul>

            {/* Inline CTA */}
            {onCtaClick && (
              <motion.button
                {...fadeInUp}
                whileInView="animate"
                initial="initial"
                viewport={{ once: true }}
                type="button"
                onClick={onCtaClick}
                className="mt-7 inline-flex cursor-pointer items-center gap-1.5 font-mono text-[10.5px] tracking-[0.06em] text-brand-accent-text uppercase transition-colors hover:text-brand-accent-hover"
              >
                {t("cta")}
                <span aria-hidden="true">&rarr;</span>
              </motion.button>
            )}

            {/* Related reading backlink */}
            {pillarSlug && (
              <div className="mt-3.5">
                <span className={`${descClass} text-[12.5px]`}>
                  {locale === "en" ? "Related reading:" : "相关阅读："}{" "}
                </span>
                <Link
                  href={`${localePath(locale, "/blog")}?pillar=${pillarSlug}`}
                  className="inline-flex items-center gap-0.5 text-[12.5px] text-brand-accent-2 transition-colors hover:text-brand-info"
                >
                  {t("relatedReading")}
                  <span aria-hidden="true">&rarr;</span>
                </Link>
              </div>
            )}
          </div>

          {/* Visual */}
          <div
            className={`${reverse ? "lg:order-1" : ""} rounded-card border ${cardBg} flex min-h-[160px] items-center justify-center p-[22px] md:min-h-[200px] md:p-[26px]`}
          >
            {visual || (
              <p className={`${descClass} font-mono text-[10px] tracking-[0.12em] uppercase`}>
                [Data visualization]
              </p>
            )}
          </div>
        </div>

        {/* How it works */}
        <motion.div
          {...fadeInUp}
          whileInView="animate"
          initial="initial"
          viewport={{ once: true }}
          className="mt-12"
        >
          <h3 className={`${titleClass} mb-4 text-[16.5px] font-semibold`}>
            {t("howItWorksTitle")}
          </h3>
          <ol className="list-decimal space-y-2.5 pl-5 marker:font-mono marker:text-[11px] marker:text-brand-accent-text">
            {(["step1", "step2", "step3"] as const).map((step) => (
              <li
                key={step}
                className={`${descClass} text-[13px] leading-[1.6]`}
              >
                {t(`howItWorks.${step}`)}
              </li>
            ))}
          </ol>
        </motion.div>

        {/* FAQ */}
        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-2">
          {["faq1", "faq2"].map((faq) => (
            <motion.div
              key={faq}
              {...fadeInUp}
              whileInView="animate"
              initial="initial"
              viewport={{ once: true }}
              className={`${faqBg} rounded-card border p-[22px] transition-colors hover:border-brand-accent/40`}
            >
              <h3 className={`${titleClass} mb-2 text-[15.5px] font-semibold`}>
                {t(`${faq}Q`)}
              </h3>
              <p className={`${descClass} text-[13px] leading-[1.6]`}>
                {t(`${faq}A`)}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
