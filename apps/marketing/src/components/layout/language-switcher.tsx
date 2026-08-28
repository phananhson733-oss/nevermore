// @input  — next-intl locale, next/navigation router/pathname
// @output — LanguageSwitcher 组件（中/EN 切换按钮）
// @pos    — Header 子组件，负责语言切换交互
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useLocale } from "next-intl";
import { useRouter, usePathname } from "next/navigation";
import { localePath, stripLocalePrefix } from "../../lib/locale-path.ts";

export function LanguageSwitcher({
  menuItem = false,
  onAction,
}: {
  readonly menuItem?: boolean;
  readonly onAction?: () => void;
} = {}) {
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();

  const switchLocale = () => {
    const newLocale = locale === "en" ? "zh" : "en";
    // The default locale has no prefix to swap, so rebuild the path from its
    // locale-agnostic form rather than substituting one prefix for another.
    router.push(localePath(newLocale, stripLocalePrefix(pathname)));
    onAction?.();
  };

  return (
    // 设计稿的语言位是 12px 的「中文」/「EN」。字体栈刻意写死 system-ui：这两个汉字
    // 是英文页面上仅有的中文，走站点字体栈会为它们拉一份 ~75KB 的 Noto Sans SC 分片。
    // system-ui 在所有目标系统上都有完整中文字形，且英文页上没有别的中文可供对比，
    // 换字体看不出来。min-h-9/min-w-9 是触摸目标：原来的裸字形只有 13x18px。
    <button
      onClick={switchLocale}
      role={menuItem ? "menuitem" : undefined}
      tabIndex={menuItem ? -1 : undefined}
      className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-[8px] text-[12px] tracking-[0.08em] text-text-dark-strong transition-colors outline-none [font-family:system-ui,sans-serif] hover:text-brand-accent-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-accent"
      aria-label={locale === "en" ? "切换到中文" : "Switch to English"}
    >
      {locale === "en" ? "中文" : "EN"}
    </button>
  );
}
