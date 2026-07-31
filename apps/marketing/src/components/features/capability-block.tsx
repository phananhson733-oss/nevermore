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

  const bgClass = isDark ? "bg-brand-bg" : "bg-brand-bg-light";
  const titleClass = isDark
    ? "text-text-dark-primary"
    : "text-text-light-primary";
  const descClass = isDark
    ? "text-text-dark-secondary"
    : "text-text-light-secondary";
  const cardBg = isDark ? "border-brand-border" : "border-gray-200";
  const faqBg = isDark
    ? "bg-brand-bg-alt border-brand-border"
    : "bg-white border-gray-200";

  return (
    <section className={`${bgClass} py-16 md:py-24`}>
      <div className="max-w-content mx-auto px-4">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-start">
          {/* Text side */}
          <div className={reverse ? "lg:order-2" : ""}>
            <motion.h2
              {...fadeInUp}
              whileInView="animate"
              initial="initial"
              viewport={{ once: true }}
              className={`${titleClass} font-semibold mb-4`}
            >
              {t("title")}
            </motion.h2>
            <motion.p
              {...fadeInUp}
              whileInView="animate"
              initial="initial"
              viewport={{ once: true }}
              transition={{ ...fadeInUp.transition, delay: 0.1 }}
              className={`${descClass} text-lg mb-8`}
            >
              {t("desc")}
            </motion.p>

            {/* Feature list */}
            <ul className="space-y-3">
              {features.map((fKey) => (
                <motion.li
                  key={fKey}
                  {...fadeInUp}
                  whileInView="animate"
                  initial="initial"
                  viewport={{ once: true }}
                  className={`${descClass} text-sm flex items-start gap-2`}
                >
                  <Check
                    className="text-brand-accent mt-0.5 h-4 w-4 shrink-0"
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
                className="mt-6 text-brand-accent text-sm font-medium hover:underline cursor-pointer inline-flex items-center gap-1"
              >
                {t("cta")}
                <span aria-hidden="true">&rarr;</span>
              </motion.button>
            )}

            {/* Related reading backlink */}
            {pillarSlug && (
              <div className="mt-3">
                <span className={`${descClass} text-xs`}>
                  {locale === "en" ? "Related reading:" : "相关阅读："}{" "}
                </span>
                <Link
                  href={`${localePath(locale, "/blog")}?pillar=${pillarSlug}`}
                  className={`${descClass} text-xs hover:text-brand-accent transition-colors inline-flex items-center gap-0.5`}
                >
                  {t("relatedReading")}
                  <span aria-hidden="true">&rarr;</span>
                </Link>
              </div>
            )}
          </div>

          {/* Visual */}
          <div
            className={`${reverse ? "lg:order-1" : ""} rounded-card border ${cardBg} p-6 md:p-8 flex items-center justify-center min-h-[160px] md:min-h-[200px]`}
          >
            {visual || (
              <p className={`${descClass} text-sm italic`}>
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
          <h3 className={`${titleClass} font-semibold text-lg mb-4`}>
            {t("howItWorksTitle")}
          </h3>
          <ol className="list-decimal list-inside space-y-3">
            {(["step1", "step2", "step3"] as const).map((step) => (
              <li key={step} className={`${descClass} text-sm leading-relaxed`}>
                {t(`howItWorks.${step}`)}
              </li>
            ))}
          </ol>
        </motion.div>

        {/* FAQ */}
        <div className="mt-12 grid grid-cols-1 md:grid-cols-2 gap-4">
          {["faq1", "faq2"].map((faq) => (
            <motion.div
              key={faq}
              {...fadeInUp}
              whileInView="animate"
              initial="initial"
              viewport={{ once: true }}
              className={`${faqBg} border rounded-card p-6`}
            >
              <h3 className={`${titleClass} font-medium text-sm mb-2`}>
                {t(`${faq}Q`)}
              </h3>
              <p className={`${descClass} text-sm leading-relaxed`}>
                {t(`${faq}A`)}
              </p>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}
