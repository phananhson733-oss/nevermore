// @input  — 无
// @output — 可视化组件共享色值常量和工具函数
// @pos    — Features 可视化组件共用基础层
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * `isDark` 不是明/暗主题之分——主题由 html[data-theme] 决定，这里管不着。
 * 这个标志表达的是「该插图落在基础底 (true) 还是交替底 (false) 上」，两条
 * 分支只差一档面板层级。名字保留是因为六个插图组件都按它传参。
 */
export interface VisualProps {
  isDark: boolean;
}

/**
 * 全部色值都是 `var(--sc-*)` 引用，不是字面量。
 *
 * 这些值最终落在 `style={{ color: … }}` 这类内联样式上，内联样式里的 var()
 * 会正常解析，所以插图跟着主题走不需要组件感知主题、也不需要任何 JS。写死
 * hex 的代价是浅色页面上会嵌进六块深色时代的插图，而且没有任何测试会红。
 *
 * 半透明色块统一用 color-mix 而不是写死 rgba：rgba 把基色也钉死了，
 * 「12% 的青」在深色底上是发光的青雾，在浅色底上得是淡蓝底——只有让基色跟着
 * token 走，同一个百分比才在两套主题下都成立。
 */
const tint = (token: string, percent: number) =>
  `color-mix(in oklab, var(${token}) ${percent}%, transparent)`;

export const C = {
  accent: "var(--sc-accent)",
  textPrimary: "var(--sc-text-primary)",
  textSecondary: "var(--sc-text-secondary)",
  bgCard: "var(--sc-panel)",
  bgDeep: "var(--sc-bg)",
  border: "var(--sc-border-card)",
  emerald: "var(--sc-accent)",
  /*
   * 四组分类标记。规范只给了一条品牌渐变和一组状态色，没有分类色板，所以这
   * 四色取自 accent 双色加 warning，第四组退到中性——比再发明两个色相更贴合
   * 「一个渐变承担全部强调」的约束，且 amber 与中性在色觉缺陷下仍可分。
   */
  blue: { bg: tint("--sc-accent-2", 12), text: "var(--sc-accent-2)" },
  purple: { bg: tint("--sc-accent", 12), text: "var(--sc-accent)" },
  amber: { bg: tint("--sc-warning", 14), text: "var(--sc-warning)" },
  green: { bg: tint("--sc-text-strong", 10), text: "var(--sc-text-strong)" },
  red: "var(--sc-error)",
} as const;

export function themeColors(isDark: boolean) {
  return {
    text: C.textPrimary,
    textDim: C.textSecondary,
    card: isDark ? C.bgCard : "var(--sc-panel-raised)",
    cardDeep: isDark ? "var(--sc-panel-sunken)" : C.bgCard,
    border: isDark ? C.border : "var(--sc-border-strong)",
    barTrack: isDark ? "var(--sc-border)" : "var(--sc-border-strong)",
    pillBg: tint("--sc-text-primary", isDark ? 6 : 9),
  };
}

export const fadeItem = {
  initial: { opacity: 0, y: 8 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
};
