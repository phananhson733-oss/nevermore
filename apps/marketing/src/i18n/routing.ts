// @input  — next-intl/routing
// @output — routing 配置（locales: en/zh, defaultLocale: en, localePrefix: as-needed）
// @pos    — i18n 核心，被 middleware 和 request.ts 依赖
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { defineRouting } from "next-intl/routing";

// as-needed：默认语言 en 不带前缀（gengrowth.ai/pricing），zh 保留前缀
// （gengrowth.ai/zh/pricing）。历史 /en/* URL 由 next-intl 收敛到无前缀形式，
// proxy.ts 再把它的 307 升级成 308，让已收录 URL 按永久迁移处理。
export const routing = defineRouting({
  locales: ["en", "zh"],
  defaultLocale: "en",
  localePrefix: "as-needed",
});
