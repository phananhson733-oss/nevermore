// @input  — next/navigation pathname, next/link Link
// @output — 404 Not Found 页面（双语硬编码）
// @pos    — [locale] 下的 404 兜底页，URL 不匹配时由 Next.js 自动渲染
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { localePath } from "@/lib/locale-path";

const copy = {
  en: {
    title: "Page Not Found",
    description:
      "The page you are looking for does not exist or has been moved.",
    button: "Back to Home",
  },
  zh: {
    title: "页面未找到",
    description: "您访问的页面不存在或已被移动。",
    button: "返回首页",
  },
} as const;

export default function NotFound() {
  const pathname = usePathname();
  const locale = pathname?.startsWith("/zh") ? "zh" : "en";
  const t = copy[locale];

  return (
    <div className="bg-brand-bg flex min-h-screen items-center justify-center px-6">
      <div className="text-center">
        {/* 状态码是「数据」而不是标题，走 mono；不用 700 字重 */}
        <p className="text-brand-accent font-mono text-[64px] leading-none tracking-[0.04em] md:text-[88px]">
          404
        </p>

        <h1 className="text-text-dark-primary mt-6 text-[26px] md:text-[32px]">
          {t.title}
        </h1>

        <p className="text-text-dark-secondary mx-auto mt-3 max-w-md text-[15.5px] leading-[1.65]">
          {t.description}
        </p>

        {/* GLOW_02 — 本屏唯一的渐变主 CTA */}
        <Link
          href={localePath(locale)}
          className="bg-brand-gradient text-brand-on-accent shadow-cta hover:shadow-cta-hover focus-visible:outline-brand-accent mt-8 inline-flex h-12 items-center justify-center rounded-[10px] px-[26px] text-[14.5px] font-semibold transition-shadow focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {t.button}
        </Link>
      </div>
    </div>
  );
}
