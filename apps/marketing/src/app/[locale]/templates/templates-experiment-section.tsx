// @input  -- next-intl, next/link, framer-motion, site config
// @output -- Live Experiment Entry section for templates page (Block 4)
// @pos    -- Sub-component of TemplatesPageClient, experiment CTA block
// once this file is updated, update header comments and _DIR.md in this folder
"use client";

import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { motion } from "framer-motion";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";

export function TemplatesExperimentSection() {
  const tExp = useTranslations("templates.experiments");
  const locale = useLocale();

  return (
    <section className="bg-brand-bg-light py-16 md:py-24">
      <div className="max-w-content mx-auto px-4 text-center">
        <motion.h2
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{
            duration: 0.6,
            ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
          }}
          className="text-text-light-primary font-semibold mb-4"
        >
          {tExp("title")}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 24 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{
            duration: 0.6,
            delay: 0.15,
            ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
          }}
          className="text-text-light-secondary text-lg max-w-2xl mx-auto mb-8"
        >
          {tExp("desc")}
        </motion.p>
        <div className="flex flex-wrap justify-center gap-6">
          <Link href={`/${locale}/blog`}>
            <Button
              size="lg"
              className="bg-brand-accent hover:bg-brand-accent-hover text-white text-base px-8 h-12"
            >
              {tExp("blogCta")}
            </Button>
          </Link>
          <a
            href={siteConfig.social.x}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button
              variant="outline"
              size="lg"
              className="border-text-light-secondary/30 text-text-light-secondary hover:border-brand-accent-on-light hover:text-brand-accent-on-light text-base px-8 h-12"
            >
              {tExp("xCta")}
            </Button>
          </a>
          <a
            href={siteConfig.social.linkedin}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button
              variant="outline"
              size="lg"
              className="border-text-light-secondary/30 text-text-light-secondary hover:border-brand-accent-on-light hover:text-brand-accent-on-light text-base px-8 h-12"
            >
              {tExp("linkedinCta")}
            </Button>
          </a>
        </div>
      </div>
    </section>
  );
}
