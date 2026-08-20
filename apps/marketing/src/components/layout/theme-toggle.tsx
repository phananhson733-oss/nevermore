// @input  — next-intl locale/common 命名空间、lib/theme 常量、lucide 图标
// @output — ThemeToggle 组件（深/浅主题切换按钮）
// @pos    — Header 子组件，与 LanguageSwitcher 并列
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { useLayoutEffect } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Moon, Sun } from "lucide-react";
import {
  isTheme,
  THEME_ATTRIBUTE,
  THEME_STORAGE_KEY,
} from "@/lib/theme";

/**
 * 主题开关。
 *
 * 这个组件刻意**不持有 React state**：当前主题的唯一真相是
 * `<html data-theme>`，而那个属性在 React 拿到控制权之前就已经由 head 里的
 * 无闪脚本写好了。若再用 useState 复制一份，服务端渲染时读不到 localStorage，
 * 首帧只能按默认值画，选了浅色的访客就会看到图标先画成太阳再跳成月亮——
 * 一个纯粹由「多存了一份状态」制造出来的闪烁。
 *
 * 于是图标的显隐交给 CSS 的 light: 变体去匹配同一个属性，点击只做两件事：
 * 改属性、记住选择。样式在同一帧内重算，没有中间态。
 */
export function ThemeToggle() {
  const t = useTranslations("common");
  const locale = useLocale();

  useLayoutEffect(() => {
    try {
      const stored = localStorage.getItem(THEME_STORAGE_KEY);
      if (isTheme(stored)) {
        document.documentElement.setAttribute(THEME_ATTRIBUTE, stored);
      }
    } catch {
      // Reading localStorage can throw in Safari private mode. The current DOM
      // theme remains usable even when there is no stored preference to restore.
    }
  }, [locale]);

  const toggle = () => {
    const root = document.documentElement;
    // 属性缺席就是默认的深色，所以「不是 light」一律按深色处理，下一个是浅色。
    const next = root.getAttribute(THEME_ATTRIBUTE) === "light" ? "dark" : "light";
    root.setAttribute(THEME_ATTRIBUTE, next);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Safari 无痕模式下写 localStorage 直接抛异常。切换本身已经生效了，
      // 只是记不住——这比让整个点击事件炸掉要好。
    }
  };

  return (
    // 尺寸与 LanguageSwitcher 对齐（min-h-9/min-w-9 的触摸目标），颜色走同一档
    // 次要文字转 accent 的 hover。
    <button
      type="button"
      onClick={toggle}
      className="inline-flex min-h-9 min-w-9 items-center justify-center text-text-dark-secondary transition-colors hover:text-brand-accent-text"
    >
      {/*
        无障碍名称也按主题分流。两段都在 DOM 里，靠 display 切换——display:none
        的那段不进无障碍树，所以读屏拿到的永远只有当前这一句。用两段静态文案
        而不是一个动态 aria-label，是为了继续不引入 React state（见组件注释）。
      */}
      <span className="sr-only light:hidden">{t("switchToLight")}</span>
      <span className="sr-only hidden light:inline">{t("switchToDark")}</span>
      <Sun className="size-4.5 light:hidden" aria-hidden="true" />
      <Moon className="hidden size-4.5 light:block" aria-hidden="true" />
    </button>
  );
}
