// @input  -- next-intl, framer-motion, pricing-cards, pricing-comparison, pricing-faq
// @output -- PricingPageClient component (all pricing page sections)
// @pos    -- pricing page client wrapper, rendered by page.tsx server component
// Once this file is updated, update the header comment and the folder's _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/animations";
import { useTrial } from "@/components/layout/waitlist-context";
import { Button } from "@/components/ui/button";
import { PricingCards } from "./pricing-cards";
import { PricingComparison } from "./pricing-comparison";
import { PricingFaq } from "./pricing-faq";

export default function PricingPageClient() {
  const tHero = useTranslations("pricing.hero");
  const tCta = useTranslations("pricing.cta");
  const { openWaitlist } = useTrial();

  return (
    <>
      {/* Hero */}
      <section className="bg-brand-bg py-16 md:py-24">
        <div className="max-w-content mx-auto px-4 text-center">
          <motion.h1
            {...fadeInUp}
            className="text-text-dark-primary font-semibold mb-4"
          >
            {tHero("title")}
          </motion.h1>
          <motion.p
            {...fadeInUp}
            transition={{ ...fadeInUp.transition, delay: 0.15 }}
            className="text-text-dark-secondary text-lg max-w-2xl mx-auto"
          >
            {tHero("subtitle")}
          </motion.p>
        </div>
      </section>

      {/* Pricing Cards */}
      <section className="bg-brand-bg py-8 md:py-16">
        <div className="max-w-content mx-auto px-4">
          <PricingCards onCtaClick={openWaitlist} />
        </div>
      </section>

      {/* Feature Comparison */}
      <section className="bg-brand-bg-alt py-16 md:py-24">
        <div className="max-w-content mx-auto px-4">
          <PricingComparison />
        </div>
      </section>

      {/* FAQ */}
      <section className="bg-brand-bg py-16 md:py-24">
        <div className="max-w-content mx-auto px-4">
          <PricingFaq />
        </div>
      </section>

      {/* Bottom CTA */}
      <section className="bg-brand-bg-alt py-16 md:py-24">
        <div className="max-w-content mx-auto px-4 text-center">
          <motion.h2
            {...fadeInUp}
            whileInView="animate"
            initial="initial"
            viewport={{ once: true }}
            className="text-text-dark-primary font-semibold mb-4"
          >
            {tCta("title")}
          </motion.h2>
          <motion.p
            {...fadeInUp}
            whileInView="animate"
            initial="initial"
            viewport={{ once: true }}
            transition={{ ...fadeInUp.transition, delay: 0.15 }}
            className="text-text-dark-secondary text-lg max-w-2xl mx-auto mb-10"
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
            <Button
              onClick={openWaitlist}
              size="lg"
              className="bg-brand-accent hover:bg-brand-accent-hover text-white text-base px-8 h-12"
            >
              {tCta("button")}
            </Button>
          </motion.div>
        </div>
      </section>
    </>
  );
}
