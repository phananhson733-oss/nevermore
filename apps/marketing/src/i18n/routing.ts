// @input  — next-intl/routing
// @output — routing 配置（locales: en/zh, defaultLocale: en）
// @pos    — i18n 核心，被 middleware 和 request.ts 依赖
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { defineRouting } from "next-intl/routing";

export const routing = defineRouting({
  locales: ["en", "zh"],
  defaultLocale: "en",
});
