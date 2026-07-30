// @input  — next-intl, framer-motion, site config, ui/button
// @output — Contact 联系页面客户端渲染（Hero + direct email contact）
// @pos    — Contact 页 client wrapper，由 page.tsx server component 引用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/animations";
import { Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { siteConfig } from "@/config/site";

export default function ContactPageClient() {
  const t = useTranslations("contact");

  return (
    <>
      {/* Hero */}
      <section className="bg-brand-bg py-16 md:py-24">
        <div className="max-w-content mx-auto px-4 text-center">
          <motion.h1
            {...fadeInUp}
            className="text-text-dark-primary font-semibold mb-4"
          >
            {t("hero.title")}
          </motion.h1>
          <motion.p
            {...fadeInUp}
            transition={{ ...fadeInUp.transition, delay: 0.15 }}
            className="text-text-dark-secondary text-lg max-w-2xl mx-auto"
          >
            {t("hero.subtitle")}
          </motion.p>
        </div>
      </section>

      {/* Direct contact */}
      <section className="bg-brand-bg py-16">
        <div className="max-w-content mx-auto px-4">
          <div className="max-w-2xl mx-auto">
            <motion.div
              {...fadeInUp}
              transition={{ ...fadeInUp.transition, delay: 0.3 }}
              className="text-center rounded-card border border-brand-border bg-brand-bg-alt p-8"
            >
              <div className="flex items-center justify-center gap-2 text-text-dark-secondary">
                <Mail className="size-5" aria-hidden="true" />
                <a
                  href={`mailto:${siteConfig.contactEmail}`}
                  className="text-brand-accent-text hover:brightness-110 transition-all"
                >
                  {siteConfig.contactEmail}
                </a>
              </div>
              <Button
                asChild
                className="mt-6 bg-brand-accent hover:bg-brand-accent-hover text-white"
              >
                <a href={`mailto:${siteConfig.contactEmail}`}>Email GenGrowth</a>
              </Button>
            </motion.div>
          </div>
        </div>
      </section>
    </>
  );
}
