// @input  — next-intl, navigation config, site config
// @output — Footer 组件（品牌信息 + 资源链接 + 法务链接 + 社媒 + 版权）
// @pos    — 全局布局组件，对应 SPEC 2.3.2 / Signal Console 设计规范
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import Link from "next/link";
import Image from "next/image";
import { footerLegalLinks, footerResourceLinks } from "@/config/navigation";
import { siteConfig } from "@/config/site";
import { localePath } from "@/lib/locale-path";

// 列标题告诉人这一列是什么，属于承载信息的标签，不能走 3.4:1 的 faint
const COLUMN_HEADING =
  "mb-3 font-mono text-[10px] tracking-[0.12em] text-text-dark-secondary uppercase";
const FOOTER_LINK =
  "text-[13px] text-text-dark-secondary transition-colors hover:text-text-dark-primary";

export function Footer({
  onOpenCookiePreferences,
}: {
  onOpenCookiePreferences?: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();

  return (
    <footer className="border-t border-brand-border bg-brand-bg pt-14">
      <div className="max-w-content mx-auto px-6 md:px-8">
        <div className="grid grid-cols-1 gap-8 pb-12 sm:grid-cols-2 lg:grid-cols-[1.4fr_1fr_1fr_1fr]">
          {/* Brand */}
          <div>
            <p className="flex items-center gap-2.5 text-base font-semibold text-text-dark-primary">
              {/* The footer sits on the dark brand surface, so it takes the
                  transparent mark like the header does. logo.png is the
                  on-light build Google's Organization logo points at; rendering
                  that here would put a white square in the footer. */}
              <Image
                src="/images/logo-mark.png"
                alt=""
                width={26}
                height={26}
              />
              GenGrowth
            </p>
            <p className="mt-3 max-w-[260px] text-[13px] leading-[1.6] text-text-dark-secondary">
              {locale === "en"
                ? "Evidence-led SEO growth system"
                : "证据驱动的 SEO 增长系统"}
            </p>
          </div>

          {/* Resources */}
          <nav aria-label={locale === "en" ? "Resources" : "资源"}>
            <p className={COLUMN_HEADING}>
              {locale === "en" ? "Resources" : "资源"}
            </p>
            <ul className="space-y-2.5">
              {footerResourceLinks.map((link) => (
                <li key={link.labelKey}>
                  <Link
                    href={localePath(locale, link.href)}
                    className={FOOTER_LINK}
                  >
                    {t(link.labelKey)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Legal Links */}
          <nav aria-label={locale === "en" ? "Legal" : "法律信息"}>
            <p className={COLUMN_HEADING}>
              {locale === "en" ? "Legal" : "法律信息"}
            </p>
            <ul className="space-y-2.5">
              {footerLegalLinks.map((link) => (
                <li key={link.labelKey}>
                  {link.isModal ? (
                    <button
                      onClick={onOpenCookiePreferences}
                      className={FOOTER_LINK}
                    >
                      {t(link.labelKey)}
                    </button>
                  ) : (
                    <Link
                      href={localePath(locale, link.href)}
                      className={FOOTER_LINK}
                    >
                      {t(link.labelKey)}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>

          {/* Social + Contact */}
          <div>
            <p className={COLUMN_HEADING}>
              {locale === "en" ? "Contact" : "联系"}
            </p>
            <div className="mb-2.5 flex gap-3.5">
              <a
                href={siteConfig.social.x}
                target="_blank"
                rel="noopener noreferrer"
                className={FOOTER_LINK}
                aria-label="X (Twitter)"
              >
                X
              </a>
              <a
                href={siteConfig.social.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className={FOOTER_LINK}
                aria-label="LinkedIn"
              >
                LinkedIn
              </a>
            </div>
            <p className="text-[13px] text-text-dark-secondary">
              {siteConfig.contactEmail}
            </p>
          </div>
        </div>

        {/* Copyright */}
        <div className="border-t border-brand-border py-5 font-mono text-[10.5px] tracking-[0.06em] text-text-dark-secondary uppercase">
          {t("footer.rights")}
        </div>
      </div>
    </footer>
  );
}
