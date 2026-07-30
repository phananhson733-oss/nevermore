// @input  — 无
// @output — 可视化组件共享色值常量和工具函数
// @pos    — Features 可视化组件共用基础层
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

export interface VisualProps {
  isDark: boolean;
}

export const C = {
  accent: "#D97757",
  textPrimary: "#F0EDE8",
  textSecondary: "#9B9690",
  bgCard: "#1A1A1C",
  bgDeep: "#131314",
  border: "rgba(240,237,232,0.1)",
  emerald: "#4ADE80",
  blue: { bg: "rgba(59,130,246,0.15)", text: "#60A5FA" },
  purple: { bg: "rgba(168,85,247,0.15)", text: "#C084FC" },
  amber: { bg: "rgba(245,158,11,0.15)", text: "#FBBF24" },
  green: { bg: "rgba(16,185,129,0.15)", text: "#34D399" },
  red: "#EF4444",
} as const;

export function themeColors(isDark: boolean) {
  return {
    text: isDark ? C.textPrimary : "#1A1A1C",
    textDim: isDark ? C.textSecondary : "#6B6560",
    card: isDark ? C.bgCard : "#FFFFFF",
    cardDeep: isDark ? C.bgDeep : "#F8F6F3",
    border: isDark ? C.border : "rgba(0,0,0,0.08)",
    barTrack: isDark ? "#333" : "#E5E0DB",
    pillBg: isDark ? "rgba(240,237,232,0.1)" : "#F0EDE8",
  };
}

export const fadeItem = {
  initial: { opacity: 0, y: 8 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true },
};
