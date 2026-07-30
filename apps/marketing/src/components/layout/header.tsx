// @input  — next-intl, navigation config, ui/button, ui/sheet, language-switcher
// @output — Header 组件（固定顶部导航栏 + 移动端侧边菜单）
// @pos    — 全局布局组件，对应 SPEC 2.3.1
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useTranslations } from "next-intl";
import { useLocale } from "next-intl";
import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { Menu } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
  SheetTitle,
} from "@/components/ui/sheet";
import { LanguageSwitcher } from "./language-switcher";
import { headerNavItems } from "@/config/navigation";
import { siteConfig } from "@/config/site";

export function Header() {
  const t = useTranslations();
  const locale = useLocale();
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 bg-brand-bg/80 backdrop-blur-md border-b border-brand-border">
      <div className="max-w-content mx-auto px-4 h-16 flex items-center justify-between">
        {/* Logo */}
        <Link
          href={`/${locale}/`}
          className="flex items-center gap-2 text-text-dark-primary font-semibold text-lg"
        >
          <Image
            src="/images/logo.png"
            alt="GenGrowth"
            width={32}
            height={32}
            className="rounded-full"
          />
          GenGrowth
        </Link>

        {/* Desktop Nav */}
        <nav
          aria-label="Main navigation"
          className="hidden md:flex items-center gap-6"
        >
          {headerNavItems.map((item) => (
            <Link
              key={item.href}
              href={`/${locale}${item.href}`}
              className="text-text-dark-secondary hover:text-text-dark-primary transition-colors text-sm"
            >
              {t(item.labelKey)}
            </Link>
          ))}
        </nav>

        {/* Right */}
        <div className="flex items-center gap-4">
          <LanguageSwitcher />
          <a
            href={siteConfig.appUrl}
            className="hidden rounded-lg bg-brand-accent px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-brand-accent-hover md:inline-flex"
          >
            {t("common.openApp")}
          </a>

          {/* Mobile Menu */}
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger asChild className="md:hidden">
              <button
                className="text-text-dark-primary p-2"
                aria-label="Open menu"
              >
                <Menu className="size-6" />
              </button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="bg-brand-bg border-brand-border"
            >
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <nav
                aria-label="Mobile navigation"
                className="flex flex-col gap-4 mt-8 px-4"
              >
                {headerNavItems.map((item) => (
                  <Link
                    key={item.href}
                    href={`/${locale}${item.href}`}
                    onClick={() => setMobileOpen(false)}
                    className="text-text-dark-secondary hover:text-text-dark-primary text-lg transition-colors"
                  >
                    {t(item.labelKey)}
                  </Link>
                ))}
                <a
                  href={siteConfig.appUrl}
                  onClick={() => setMobileOpen(false)}
                  className="mt-4 rounded-lg bg-brand-accent px-4 py-2 text-center font-semibold text-white transition-colors hover:bg-brand-accent-hover"
                >
                  {t("common.openApp")}
                </a>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}
