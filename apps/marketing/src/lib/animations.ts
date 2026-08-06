// @input  — 无（纯数据）
// @output — fadeInUp / staggerContainer / staggerItem 动画变体
// @pos    — Framer Motion 预设动效，供页面组件引用（SPEC 8.2.6）
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

/*
 * Signal Console 的动效跟它的光效一样是克制的：位移收到 14px、时长收到 0.45s，
 * 元素像是「落位」而不是「飞入」。24px / 0.6s 那档在一屏有四到八张卡片时会读成
 * 页面在晃——网格越密，单个元素能承受的位移越小。
 */
export const fadeInUp = {
  initial: { opacity: 0, y: 14 },
  animate: { opacity: 1, y: 0 },
  transition: {
    duration: 0.45,
    ease: EASE,
  },
} as const;

export const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.06,
    },
  },
} as const;

export const staggerItem = {
  initial: { opacity: 0, y: 14 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: EASE },
  },
} as const;
