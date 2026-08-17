// @input  — 无（纯常量与纯函数）
// @output — 主题标识、localStorage 键名、首屏无闪脚本源码
// @pos    — 主题机制的唯一权威；被 [locale]/layout（注入脚本）与 theme-toggle（读写）共用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * 站点主题。深色是默认——设计规范 Signal Console v1 出的就是深色一版，
 * 浅色是本次新增的可选项，不是新的默认。
 */
export const THEMES = ["dark", "light"] as const;

export type Theme = (typeof THEMES)[number];

export const DEFAULT_THEME: Theme = "dark";

/**
 * 存访客的选择。带 `gg-` 前缀是因为 localStorage 在 gengrowth.ai 这个 origin 上
 * 是全站共享的，营销站和别的东西撞一个裸 `theme` 键只是时间问题。
 */
export const THEME_STORAGE_KEY = "gg-theme";

/**
 * 主题写在 `<html data-theme>` 上，不是 class 上。选它有两个理由：属性选择器
 * 天然是单值的（class 允许 `dark light` 同时存在这种没有意义的状态），以及
 * SSR 出来的 HTML 上**没有**这个属性时含义明确——就是默认的深色，不需要为
 * 「还没决定」再造一个第三值。
 */
export const THEME_ATTRIBUTE = "data-theme";

export function isTheme(value: unknown): value is Theme {
  return typeof value === "string" && (THEMES as readonly string[]).includes(value);
}

/**
 * 首屏无闪脚本。
 *
 * 它必须在 `<head>` 里同步执行：浏览器渲染第一帧之前就得把属性写上去，否则
 * 选了浅色的访客每次导航都会先闪一下深色底再翻白。React 的任何生命周期都太晚
 * ——那时首帧已经画完了。
 *
 * 三条刻意的设计：
 * ① 只在存了值且值合法时才写属性。存储里是垃圾（用户手改、别的脚本写脏）时
 *    什么都不做，落回 CSS 里的默认深色，而不是把垃圾原样写进 DOM 让选择器
 *    去匹配一个不存在的主题。
 * ② 整段包在 try/catch 里。Safari 无痕模式下读 localStorage 会直接抛异常，
 *    而这段脚本是页面里第一个跑的东西——它抛了，后面什么都别想执行。
 * ③ 不读 prefers-color-scheme。当前默认口径是「跟设计规范走，全站深色」，
 *    浅色是访客主动选的。哪天要改成跟随系统，改的是这一处。
 */
export const THEME_INIT_SCRIPT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});if(t===${JSON.stringify("light")}||t===${JSON.stringify(
  "dark",
)}){document.documentElement.setAttribute(${JSON.stringify(
  THEME_ATTRIBUTE,
)},t);}}catch(e){}})();`;
