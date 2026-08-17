// @input  — @/types 中的 NavItem / FooterLink 类型
// @output — 顶部主导航、Agents / Resources 子菜单及 footer 链接数据
// @pos    — 静态配置，供 Header 和 Footer 组件消费
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import type { NavItem, FooterLink, NavMenuGroup, NavMenuItem } from "@/types";

export function menuItemPath(
  basePath: string,
  item: Pick<NavMenuItem, "href" | "slug">,
): string {
  return item.href ?? `${basePath}/${item.slug}`;
}

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
        slug: "geo",
        labelKey: "nav.agentsMenu.geo.label",
        descriptionKey: "nav.agentsMenu.geo.description",
        icon: "Radar",
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

export const resourcesMenuGroups: NavMenuGroup[] = [
  {
    labelKey: "nav.resourcesMenu.group",
    items: [
      {
        slug: "prompts",
        href: "/prompts",
        labelKey: "nav.resourcesMenu.prompts.label",
        descriptionKey: "nav.resourcesMenu.prompts.description",
        icon: "MessageSquareText",
      },
      {
        slug: "tools",
        href: "/tools",
        labelKey: "nav.resourcesMenu.tools.label",
        descriptionKey: "nav.resourcesMenu.tools.description",
        icon: "Wrench",
      },
      {
        slug: "skills",
        href: "/skills",
        labelKey: "nav.resourcesMenu.skills.label",
        descriptionKey: "nav.resourcesMenu.skills.description",
        icon: "Sparkles",
      },
      {
        slug: "docs",
        href: "/resources#docs",
        labelKey: "nav.resourcesMenu.docs.label",
        descriptionKey: "nav.resourcesMenu.docs.description",
        icon: "BookOpen",
      },
    ],
  },
];

export const headerNavItems: NavItem[] = [
  { labelKey: "common.home", href: "/" },
  {
    labelKey: "nav.agents",
    href: "/agents",
    menu: agentsMenuGroups,
    menuViewAllLabelKey: "nav.agentsMenu.viewAll",
  },
  { labelKey: "nav.blog", href: "/blog" },
  {
    labelKey: "nav.resources",
    href: "/resources",
    menu: resourcesMenuGroups,
    menuViewAllLabelKey: "nav.resourcesMenu.viewAll",
  },
  { labelKey: "nav.pricing", href: "/pricing" },
];

export const footerResourceLinks: FooterLink[] = [
  { labelKey: "nav.resourcesMenu.prompts.label", href: "/prompts" },
  { labelKey: "nav.resourcesMenu.tools.label", href: "/tools" },
  { labelKey: "nav.resourcesMenu.skills.label", href: "/skills" },
  { labelKey: "nav.resourcesMenu.docs.label", href: "/resources#docs" },
];

export const footerLegalLinks: FooterLink[] = [
  { labelKey: "footer.privacy", href: "/privacy" },
  { labelKey: "footer.terms", href: "/terms" },
  { labelKey: "footer.copyright", href: "/copyright" },
  { labelKey: "footer.cookiePreferences", href: "#", isModal: true },
];
