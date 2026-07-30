// @input  — 无
// @output — NavItem / FooterLink / SocialLink 类型
// @pos    — 导航相关类型，供 config/navigation.ts 和布局组件使用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
export interface NavItem {
  labelKey: string;
  href: string;
}

export interface FooterLink {
  labelKey: string;
  href: string;
  isModal?: boolean;
}

export interface SocialLink {
  platform: string;
  url: string;
  icon: string;
}
