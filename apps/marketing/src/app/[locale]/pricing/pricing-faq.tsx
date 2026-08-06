// @input  -- next-intl, framer-motion
// @output -- PricingFaq component (accordion-style FAQ section)
// @pos    -- pricing page sub-component, rendered by pricing-page-client
// Once this file is updated, update the header comment and the folder's _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { fadeInUp, staggerContainer, staggerItem } from "@/lib/animations";

const FAQ_KEYS = ["q1", "q2", "q3", "q4", "q5"] as const;

export function PricingFaq() {
  const tFaq = useTranslations("pricing.faq");

  return (
    <>
      <motion.h2
        {...fadeInUp}
        whileInView="animate"
        initial="initial"
        viewport={{ once: true }}
        className="mb-9 text-center text-text-dark-primary"
      >
        {tFaq("title")}
      </motion.h2>

      <motion.div
        {...staggerContainer}
        initial="initial"
        whileInView="animate"
        viewport={{ once: true }}
        className="mx-auto max-w-3xl space-y-3"
      >
        {FAQ_KEYS.map((key) => (
          <motion.details
            key={key}
            {...staggerItem}
            className="group rounded-[10px] border border-brand-border-card bg-brand-panel transition-colors open:border-brand-accent/40 hover:border-brand-border-strong"
          >
            <summary className="flex list-none cursor-pointer items-center justify-between px-5 py-3.5 text-[14.5px] font-medium text-text-dark-primary transition-colors group-hover:text-brand-accent-text">
              {tFaq(`${key}.question`)}
              <span className="ml-4 shrink-0 font-mono text-[15px] text-text-dark-faint transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <div className="px-5 pb-4 text-[13px] leading-[1.65] text-text-dark-secondary">
              {tFaq(`${key}.answer`)}
            </div>
          </motion.details>
        ))}
      </motion.div>
    </>
  );
}
