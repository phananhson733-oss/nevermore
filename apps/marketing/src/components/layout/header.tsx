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
import { ToolsMenu, ToolsMenuMobile } from "./tools-menu";
import {
  SignInControl,
  SignInControlMobile,
} from "@/components/auth/sign-in-control";
import { SignInDialog } from "@/components/auth/sign-in-dialog";
import { headerNavItems } from "@/config/navigation";
import { localePath } from "@/lib/locale-path";

export function Header() {
  const t = useTranslations();
  const locale = useLocale();
  const [mobileOpen, setMobileOpen] = useState(false);
  // Owned here rather than by either trigger: the mobile trigger lives inside
  // the sheet, and a dialog nested there would unmount as the sheet closed.
  const [signInOpen, setSignInOpen] = useState(false);

  return (
    <header className="fixed top-0 right-0 left-0 z-50 border-b border-brand-border/80 bg-brand-bg/75 backdrop-blur-[14px]">
      <div className="max-w-content mx-auto flex h-17 items-center justify-between px-6 md:px-8">
        {/* Logo */}
        <Link
          href={localePath(locale)}
          className="flex items-center gap-2.5 text-base font-semibold text-text-dark-primary"
        >
          {/* The Direction A mark is a shape, not a disc: its arrow runs out to
              the top-right corner of the canvas. The round crop this used to
              carry was there to hide the old file's white corners, and applying
              it to this mark would cut the arrow off instead. logo.png stays
              opaque for the Organization JSON-LD; the header takes the bare
              transparent mark, which the brand kit sizes for 32px and up. */}
          <Image
            src="/images/logo-mark.png"
            alt="GenGrowth"
            width={32}
            height={32}
          />
          GenGrowth
        </Link>

        {/* Desktop Nav */}
        <nav
          aria-label="Main navigation"
          className="hidden items-center gap-7.5 md:flex"
        >
          {headerNavItems.map((item) =>
            item.menu ? (
              <ToolsMenu
                key={item.href}
                groups={item.menu}
                locale={locale}
                triggerLabel={t(item.labelKey)}
              />
            ) : (
              <Link
                key={item.href}
                href={localePath(locale, item.href)}
                className="text-[13.5px] text-text-dark-secondary transition-colors hover:text-text-dark-primary"
              >
                {t(item.labelKey)}
              </Link>
            ),
          )}
        </nav>

        {/* Right */}
        <div className="flex items-center gap-4">
          <LanguageSwitcher />
          <SignInControl onSignIn={() => setSignInOpen(true)} />

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
              className="border-brand-border bg-brand-bg"
            >
              <SheetTitle className="sr-only">Navigation</SheetTitle>
              <nav
                aria-label="Mobile navigation"
                className="mt-8 flex flex-col gap-4 px-4"
              >
                {headerNavItems.map((item) =>
                  item.menu ? (
                    <ToolsMenuMobile
                      key={item.href}
                      groups={item.menu}
                      locale={locale}
                      triggerLabel={t(item.labelKey)}
                      onNavigate={() => setMobileOpen(false)}
                    />
                  ) : (
                    <Link
                      key={item.href}
                      href={localePath(locale, item.href)}
                      onClick={() => setMobileOpen(false)}
                      className="text-lg text-text-dark-secondary transition-colors hover:text-text-dark-primary"
                    >
                      {t(item.labelKey)}
                    </Link>
                  ),
                )}
                <SignInControlMobile
                  onNavigate={() => setMobileOpen(false)}
                  onSignIn={() => setSignInOpen(true)}
                />
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      <SignInDialog open={signInOpen} onOpenChange={setSignInOpen} />
    </header>
  );
}
