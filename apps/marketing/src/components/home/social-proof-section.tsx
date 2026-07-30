// @input  — next-intl, framer-motion
// @output — SocialProofSection 组件（公开构建信任 + 早期用户计数 + 社媒引用 + 实验节奏）
// @pos    — 首页区块 6，深色背景，SPEC 2.5.2
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import Link from "next/link";
import { motion } from "framer-motion";
import { fadeInUp } from "@/lib/animations";

function FingerprintIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
      <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
      <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
      <path d="M2 12a10 10 0 0 1 18-6" />
      <path d="M2 16h.01" />
      <path d="M21.8 16c.2-2 .131-5.354 0-6" />
      <path d="M5 19.5C5.5 18 6 15 6 12a6 6 0 0 1 .34-2" />
      <path d="M8.65 22c.21-.66.45-1.32.57-2" />
      <path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
    </svg>
  );
}

function CommunityIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function RhythmIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M12 20V10" />
      <path d="M18 20V4" />
      <path d="M6 20v-4" />
    </svg>
  );
}

export function SocialProofSection() {
  const t = useTranslations("home.socialProof");
  const locale = useLocale();

  const trustItems = [
    {
      icon: <FingerprintIcon />,
      title: t("earlyUsers"),
      sub: null,
    },
    {
      icon: <CommunityIcon />,
      title: t("communityTitle"),
      sub: t("communitySub"),
    },
    {
      icon: <RhythmIcon />,
      title: t("rhythmTitle"),
      sub: t("rhythmSub"),
    },
  ];

  return (
    <section className="bg-brand-bg py-16 md:py-24">
      <div className="max-w-content mx-auto px-4 text-center">
        <motion.h2
          {...fadeInUp}
          whileInView="animate"
          initial="initial"
          viewport={{ once: true }}
          className="text-text-dark-primary font-semibold text-3xl md:text-4xl mb-4"
        >
          {t("title")}
        </motion.h2>

        <motion.p
          {...fadeInUp}
          whileInView="animate"
          initial="initial"
          viewport={{ once: true }}
          transition={{ ...fadeInUp.transition, delay: 0.15 }}
          className="text-text-dark-secondary text-lg max-w-2xl mx-auto mb-14"
        >
          {t("subtitle")}
        </motion.p>

        <motion.div
          {...fadeInUp}
          whileInView="animate"
          initial="initial"
          viewport={{ once: true }}
          transition={{ ...fadeInUp.transition, delay: 0.3 }}
          className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto mb-12"
        >
          {trustItems.map((item, i) => (
            <div
              key={i}
              className="border border-brand-border rounded-card p-8 flex flex-col items-center gap-4 hover:border-brand-accent/40 transition-colors"
            >
              <div className="text-brand-accent">{item.icon}</div>
              <p className="text-text-dark-primary font-semibold text-lg">
                {item.title}
              </p>
              {item.sub && (
                <p className="text-text-dark-secondary text-sm">
                  {item.sub}
                </p>
              )}
            </div>
          ))}
        </motion.div>

        <Link
          href={`/${locale}/blog`}
          className="text-brand-accent-text hover:text-brand-accent-hover font-medium text-sm transition-colors"
        >
          {t("cta")}
        </Link>
      </div>
    </section>
  );
}
