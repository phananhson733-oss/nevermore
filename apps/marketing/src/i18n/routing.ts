// @input  — next-intl/routing
// @output — routing 配置（URL-only locale，不读取或写入 locale cookie）
// @pos    — i18n 核心，被 middleware 和 request.ts 依赖
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { defineRouting } from "next-intl/routing";

// as-needed：默认语言 en 不带前缀（gengrowth.ai/pricing），zh 保留前缀
// （gengrowth.ai/zh/pricing）。历史 /en/* URL 由 next-intl 收敛到无前缀形式，
// proxy.ts 再把它的 307 升级成 308，让已收录 URL 按永久迁移处理。
// localeDetection: false —— 语言只由 URL 决定。as-needed 让英文落在无前缀路径上，
// 于是每个无前缀 URL 都进入了 next-intl 语言检测的射程：中文浏览器请求 /pricing
// 会被 307 送到 /zh/pricing，只有英文版的文章因此落到 404，而语言切换器 push 回
// "/" 也会被同一条重定向弹回 /zh，看起来就是按钮点了没反应。Google 也不建议按
// Accept-Language 自动跳转，跨语言发现交给 hreflang 与切换按钮。
export const routing = defineRouting({
  locales: ["en", "zh"],
  defaultLocale: "en",
  localePrefix: "as-needed",
  localeDetection: false,
  localeCookie: false,
});
