// @input  — @/types 中的 NavItem / FooterLink 类型
// @output — Agents 主导航、footerResourceLinks / footerLegalLinks 导航数据
// @pos    — 静态配置，供 Header 和 Footer 组件消费
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import type { NavItem, FooterLink, NavMenuGroup } from "@/types";

/**
 * The two focused acquisition Agents surfaced in the primary header submenu.
 *
 * Agent route directories are the catalogue authority. `navigation.test.ts`
 * fails if the menu and those directories drift in either direction.
 */
export const agentsMenuGroups: NavMenuGroup[] = [
  {
    labelKey: "nav.agentsMenu.group",
    items: [
      {
        slug: "seo",
        labelKey: "nav.agentsMenu.seo.label",
        descriptionKey: "nav.agentsMenu.seo.description",
        icon: "ScanSearch",
      },
      {
        slug: "tech",
        labelKey: "nav.agentsMenu.tech.label",
        descriptionKey: "nav.agentsMenu.tech.description",
        icon: "Wrench",
      },
    ],
  },
];

export const headerNavItems: NavItem[] = [
  {
    labelKey: "nav.agents",
    href: "/agents",
    menu: agentsMenuGroups,
    menuViewAllLabelKey: "nav.agentsMenu.viewAll",
  },
  { labelKey: "nav.blog", href: "/blog" },
  { labelKey: "nav.pricing", href: "/pricing" },
];

export const footerResourceLinks: FooterLink[] = [
  { labelKey: "nav.tools", href: "/tools" },
  { labelKey: "nav.blog", href: "/blog" },
  { labelKey: "nav.pricing", href: "/pricing" },
];

export const footerLegalLinks: FooterLink[] = [
  { labelKey: "footer.privacy", href: "/privacy" },
  { labelKey: "footer.terms", href: "/terms" },
  { labelKey: "footer.copyright", href: "/copyright" },
  { labelKey: "footer.cookiePreferences", href: "#", isModal: true },
];
