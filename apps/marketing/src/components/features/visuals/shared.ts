// @input  — 无
// @output — 可视化组件共享色值常量和工具函数
// @pos    — Features 可视化组件共用基础层
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

/**
 * `isDark` 在 Signal Console 下不再是明/暗之分——全站统一深色，区块靠 bg 与
 * bg-alt 交替加 1px 分隔线来分段。这个标志现在表达的是「该插图落在基础底
 * (true) 还是交替底 (false) 上」，两条分支都返回深色值，只是面板层级差一档。
 */
export interface VisualProps {
  isDark: boolean;
}

export const C = {
  accent: "#3DDC97",
  textPrimary: "#E8EDF2",
  textSecondary: "#8B96A5",
  bgCard: "#0E141C",
  bgDeep: "#0B0F14",
  border: "#1E2937",
  emerald: "#3DDC97",
  /*
   * 四组分类标记。新规范只给了一条品牌渐变和一组状态色，没有分类色板，所以这
   * 四色取自 accent 双色加 warning，第四组退到中性——比再发明两个色相更贴合
   * 「一个渐变承担全部强调」的约束，且 amber 与中性在色觉缺陷下仍可分。
   */
  blue: { bg: "rgba(76,195,250,0.12)", text: "#4CC3FA" },
  purple: { bg: "rgba(61,220,151,0.12)", text: "#3DDC97" },
  amber: { bg: "rgba(229,200,120,0.14)", text: "#E5C878" },
  green: { bg: "rgba(184,194,206,0.10)", text: "#B8C2CE" },
  red: "#F09090",
} as const;

export function themeColors(isDark: boolean) {
  return {
    text: C.textPrimary,
    textDim: C.textSecondary,
    card: isDark ? C.bgCard : "#111823",
    cardDeep: isDark ? "#0C1219" : C.bgCard,
    border: isDark ? C.border : "#24303E",
    barTrack: isDark ? "#1B2430" : "#24303E",
    pillBg: isDark ? "rgba(232,237,242,0.06)" : "rgba(232,237,242,0.09)",
  };
}

export const fadeItem = {
  initial: { opacity: 0, y: 8 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
};
