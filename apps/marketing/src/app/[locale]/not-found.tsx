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
    <div className="bg-brand-bg flex min-h-screen items-center justify-center px-4">
      <div className="text-center">
        <p className="text-brand-accent text-6xl md:text-8xl font-bold">404</p>

        <h1 className="text-text-dark-primary mt-4 md:mt-6 text-2xl md:text-3xl font-semibold">
          {t.title}
        </h1>

        <p className="text-text-dark-secondary mt-3 max-w-md text-lg">
          {t.description}
        </p>

        <Link
          href={localePath(locale)}
          className="bg-brand-accent mt-8 inline-block rounded-lg px-6 py-3 text-white transition-opacity hover:opacity-90"
        >
          {t.button}
        </Link>
      </div>
    </div>
  );
}
