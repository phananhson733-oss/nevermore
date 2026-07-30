// @input  — next-intl, navigation config, site config
// @output — Footer 组件（品牌信息 + 资源链接 + 法务链接 + 社媒 + 版权）
// @pos    — 全局布局组件，对应 SPEC 2.3.2
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import Link from "next/link";
import { footerLegalLinks, footerResourceLinks } from "@/config/navigation";
import { siteConfig } from "@/config/site";

export function Footer({
  onOpenCookiePreferences,
}: {
  onOpenCookiePreferences?: () => void;
}) {
  const t = useTranslations();
  const locale = useLocale();

  return (
    <footer className="bg-brand-bg border-t border-brand-border py-12 md:py-16">
      <div className="max-w-content mx-auto px-4">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Brand */}
          <div>
            <p className="text-text-dark-primary font-semibold text-lg mb-2">
              GenGrowth
            </p>
            <p className="text-text-dark-secondary text-sm">
              {locale === "en"
                ? "Automated Growth Operating System"
                : "自动化增长操作系统"}
            </p>
          </div>

          {/* Resources */}
          <nav aria-label={locale === "en" ? "Resources" : "资源"}>
            <p className="text-text-dark-primary font-semibold text-sm mb-3">
              {locale === "en" ? "Resources" : "资源"}
            </p>
            <ul className="space-y-2">
              {footerResourceLinks.map((link) => (
                <li key={link.labelKey}>
                  <Link
                    href={`/${locale}${link.href}`}
                    className="text-text-dark-secondary hover:text-text-dark-primary text-sm transition-colors"
                  >
                    {t(link.labelKey)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          {/* Legal Links */}
          <nav aria-label={locale === "en" ? "Legal" : "法律信息"}>
            <p className="text-text-dark-primary font-semibold text-sm mb-3">
              {locale === "en" ? "Legal" : "法律信息"}
            </p>
            <ul className="space-y-2">
              {footerLegalLinks.map((link) => (
                <li key={link.labelKey}>
                  {link.isModal ? (
                    <button
                      onClick={onOpenCookiePreferences}
                      className="text-text-dark-secondary hover:text-text-dark-primary text-sm transition-colors"
                    >
                      {t(link.labelKey)}
                    </button>
                  ) : (
                    <Link
                      href={`/${locale}${link.href}`}
                      className="text-text-dark-secondary hover:text-text-dark-primary text-sm transition-colors"
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
            <div className="flex gap-4 mb-4">
              <a
                href={siteConfig.social.x}
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-dark-secondary hover:text-text-dark-primary transition-colors text-sm"
                aria-label="X (Twitter)"
              >
                X
              </a>
              <a
                href={siteConfig.social.linkedin}
                target="_blank"
                rel="noopener noreferrer"
                className="text-text-dark-secondary hover:text-text-dark-primary transition-colors text-sm"
                aria-label="LinkedIn"
              >
                LinkedIn
              </a>
            </div>
            <p className="text-text-dark-secondary text-sm">
              {siteConfig.contactEmail}
            </p>
          </div>
        </div>

        {/* Copyright */}
        <div className="mt-12 pt-8 border-t border-brand-border">
          <p className="text-text-dark-secondary text-sm text-center">
            {t("footer.rights")}
          </p>
        </div>
      </div>
    </footer>
  );
}
