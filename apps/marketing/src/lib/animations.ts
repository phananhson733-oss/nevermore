// @input  — 无（纯数据）
// @output — fadeInUp / staggerContainer / staggerItem 动画变体
// @pos    — Framer Motion 预设动效，供页面组件引用（SPEC 8.2.6）
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

const EASE = [0.16, 1, 0.3, 1] as [number, number, number, number];

export const fadeInUp = {
  initial: { opacity: 0, y: 24 },
  animate: { opacity: 1, y: 0 },
  transition: {
    duration: 0.6,
    ease: EASE,
  },
} as const;

export const staggerContainer = {
  animate: {
    transition: {
      staggerChildren: 0.1,
    },
  },
} as const;

export const staggerItem = {
  initial: { opacity: 0, y: 24 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: EASE },
  },
} as const;
