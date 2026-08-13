// @input  — 无
// @output — NavItem / NavMenuGroup / FooterLink / SocialLink 类型
// @pos    — 通用导航类型，供 config/navigation.ts 和布局组件使用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
export interface NavItem {
  labelKey: string;
  href: string;
  /** Present when the item opens a submenu instead of navigating on its own. */
  menu?: NavMenuGroup[];
  /** Translation key for the directory link at the foot of a submenu. */
  menuViewAllLabelKey?: string;
}

/** One labelled section of a header submenu. */
export interface NavMenuGroup {
  labelKey: string;
  items: NavMenuItem[];
}

export interface NavMenuItem {
  /** Stable catalogue key and, without an href override, the parent route segment. */
  slug: string;
  /** Exact destination for entries that do not live below the parent route. */
  href?: string;
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
