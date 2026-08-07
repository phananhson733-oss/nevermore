// @input  — 无
// @output — NavItem / FooterLink / SocialLink 类型
// @pos    — 导航相关类型，供 config/navigation.ts 和布局组件使用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
export interface NavItem {
  labelKey: string;
  href: string;
  /** Present when the item opens a submenu instead of navigating on its own. */
  menu?: NavMenuGroup[];
}

/** One labelled section of a header submenu (mirrors the /tools hub sections). */
export interface NavMenuGroup {
  labelKey: string;
  items: NavMenuItem[];
}

export interface NavMenuItem {
  /** The tool's route segment — also the join key against the /tools hub. */
  slug: string;
  labelKey: string;
  descriptionKey: string;
  /** Lucide icon name, resolved to a component by the rendering layer so this
   *  config stays free of React imports. */
  icon: string;
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
