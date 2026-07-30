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
        className="text-text-dark-primary font-semibold text-center mb-12"
      >
        {tFaq("title")}
      </motion.h2>

      <motion.div
        {...staggerContainer}
        initial="initial"
        whileInView="animate"
        viewport={{ once: true }}
        className="max-w-3xl mx-auto space-y-6"
      >
        {FAQ_KEYS.map((key) => (
          <motion.details
            key={key}
            {...staggerItem}
            className="group border border-white/10 rounded-card"
          >
            <summary className="cursor-pointer px-6 py-4 text-text-dark-primary font-medium list-none flex items-center justify-between">
              {tFaq(`${key}.question`)}
              <span className="text-text-dark-secondary ml-4 shrink-0 transition-transform group-open:rotate-45">
                +
              </span>
            </summary>
            <div className="px-6 pb-4 text-text-dark-secondary text-sm leading-relaxed">
              {tFaq(`${key}.answer`)}
            </div>
          </motion.details>
        ))}
      </motion.div>
    </>
  );
}
