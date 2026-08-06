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
      <section className="bg-brand-bg relative overflow-hidden pt-16 pb-16 md:pt-21 md:pb-20">
        {/* GLOW_01 — 页级 hero 才允许的网格 + 氛围光 */}
        <div
          aria-hidden="true"
          className="bg-signal-grid absolute inset-0 opacity-40"
        />
        <div
          aria-hidden="true"
          className="absolute -top-30 right-[6%] hidden h-70 w-100 rounded-full bg-[radial-gradient(ellipse,rgba(61,220,151,0.13),transparent_65%)] blur-[12px] md:block"
        />
        <div className="max-w-content relative mx-auto px-6 text-center md:px-8">
          <motion.h1 {...fadeInUp} className="text-text-dark-primary">
            {t("hero.title")}
          </motion.h1>
          <motion.p
            {...fadeInUp}
            transition={{ ...fadeInUp.transition, delay: 0.15 }}
            className="text-text-dark-secondary mx-auto mt-5 max-w-2xl text-[17.5px] leading-[1.65]"
          >
            {t("hero.subtitle")}
          </motion.p>
        </div>
      </section>

      {/* Direct contact */}
      <section className="bg-brand-bg border-brand-border border-t py-16 md:py-22">
        <div className="max-w-content mx-auto px-6 md:px-8">
          <div className="mx-auto max-w-2xl">
            <motion.div
              {...fadeInUp}
              transition={{ ...fadeInUp.transition, delay: 0.3 }}
              className="border-brand-border-card bg-brand-panel rounded-card border p-[26px] text-center"
            >
              <div className="text-text-dark-secondary flex items-center justify-center gap-2.5">
                <Mail className="text-brand-accent size-[15px]" aria-hidden="true" />
                {/* 邮箱是标识而不是正文，走 mono */}
                <a
                  href={`mailto:${siteConfig.contactEmail}`}
                  className="text-brand-accent-text hover:text-brand-accent-hover font-mono text-[14px] transition-colors"
                >
                  {siteConfig.contactEmail}
                </a>
              </div>
              {/* GLOW_02 — 本屏唯一的渐变主 CTA */}
              <Button
                asChild
                className="bg-brand-gradient text-brand-on-accent shadow-cta hover:shadow-cta-hover mt-6 h-12 rounded-[10px] px-[26px] text-[14.5px] font-semibold"
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
