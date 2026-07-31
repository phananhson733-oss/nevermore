// @input  — next-intl locale, next/navigation router/pathname
// @output — LanguageSwitcher 组件（中/EN 切换按钮）
// @pos    — Header 子组件，负责语言切换交互
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useLocale } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { localePath, stripLocalePrefix } from "@/lib/locale-path";

export function LanguageSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const switchLocale = () => {
    const newLocale = locale === "en" ? "zh" : "en";
    // The default locale has no prefix to swap, so rebuild the path from its
    // locale-agnostic form rather than substituting one prefix for another.
    router.push(localePath(newLocale, stripLocalePrefix(pathname)));
  };

  return (
    <button
      onClick={switchLocale}
      className="text-text-dark-secondary hover:text-text-dark-primary transition-colors text-sm font-medium"
      aria-label={locale === "en" ? "切换到中文" : "Switch to English"}
    >
      {locale === "en" ? "中" : "EN"}
    </button>
  );
}
