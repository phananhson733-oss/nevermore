// @input  — clsx, tailwind-merge
// @output — cn() className 合并工具函数
// @pos    — 基础工具，被几乎所有 UI 组件依赖
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
