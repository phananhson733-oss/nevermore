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
import { localePath } from "@/lib/locale-path";

export function TemplatesExperimentSection() {
  const tExp = useTranslations("templates.experiments");
  const locale = useLocale();

  return (
    <section className="bg-brand-bg-alt border-brand-border border-t py-16 md:py-22">
      <div className="max-w-content mx-auto px-6 text-center md:px-8">
        <motion.h2
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{
            duration: 0.45,
            ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
          }}
          className="text-text-dark-primary mb-4"
        >
          {tExp("title")}
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 14 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{
            duration: 0.45,
            delay: 0.15,
            ease: [0.16, 1, 0.3, 1] as [number, number, number, number],
          }}
          className="text-text-dark-secondary mx-auto mb-8 max-w-2xl text-[15.5px] leading-[1.65]"
        >
          {tExp("desc")}
        </motion.p>
        {/* 一屏一个主 CTA：博客入口走渐变，两个社交入口退到描边。 */}
        <div className="flex flex-wrap justify-center gap-3.5">
          <Link href={localePath(locale, "/blog")}>
            <Button
              size="lg"
              className="bg-brand-gradient text-brand-on-accent shadow-cta hover:shadow-cta-hover h-12 rounded-[10px] px-[26px] text-[14.5px] font-semibold"
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
              className="border-brand-border-strong bg-brand-panel/60 text-text-dark-primary hover:border-brand-accent/50 hover:bg-brand-panel hover:text-text-dark-primary h-12 rounded-[10px] px-6 text-[14.5px] font-medium shadow-none transition-colors"
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
              className="border-brand-border-strong bg-brand-panel/60 text-text-dark-primary hover:border-brand-accent/50 hover:bg-brand-panel hover:text-text-dark-primary h-12 rounded-[10px] px-6 text-[14.5px] font-medium shadow-none transition-colors"
            >
              {tExp("linkedinCta")}
            </Button>
          </a>
        </div>
      </div>
    </section>
  );
}
