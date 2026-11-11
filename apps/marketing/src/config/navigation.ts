// @input  — @/types 中的 NavItem / FooterLink 类型
// @output — 顶部主导航、GGBoost（任务中心；我的推广 / 我的收益 由 PROMOTER_PAGES_VISIBLE 控制，当前隐藏）/ 网站审查 / Resources 子菜单及 footer 链接数据
// @pos    — 静态配置，供 Header 和 Footer 组件消费
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import type { NavItem, FooterLink, NavMenuGroup, NavMenuItem } from "@/types";

import { PROMOTER_PAGES_VISIBLE } from "../lib/task-center/visibility.ts";

export function menuItemPath(
  basePath: string,
  item: Pick<NavMenuItem, "href" | "slug">,
): string {
  return item.href ?? `${basePath}/${item.slug}`;
}

/**
 * Agent destinations surfaced in the primary header submenu.
 *
 * SEO and GEO stay on their Agent routes. `/agents/tech` remains a subordinate
 * compatibility route without primary-menu promotion.
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
    ],
  },
];

/**
 * The promoter pages, grouped under one header entry. Each has its own
 * top-level route (they share a tab row rather than a parent path), so every
 * item carries an explicit href. My Promotions and My Earnings are listed only
 * while PROMOTER_PAGES_VISIBLE is on.
 */
const promoterOnlyPages = new Set(["promotions", "earnings"]);

export const ggboostMenuGroups: NavMenuGroup[] = [
  {
    labelKey: "nav.ggboostMenu.group",
    items: ([
      {
        slug: "tasks",
        href: "/tasks",
        labelKey: "nav.ggboostMenu.tasks.label",
        descriptionKey: "nav.ggboostMenu.tasks.description",
        icon: "ClipboardList",
      },
      {
        slug: "promotions",
        href: "/promotions",
        labelKey: "nav.ggboostMenu.promotions.label",
        descriptionKey: "nav.ggboostMenu.promotions.description",
        icon: "Link2",
      },
      {
        slug: "earnings",
        href: "/earnings",
        labelKey: "nav.ggboostMenu.earnings.label",
        descriptionKey: "nav.ggboostMenu.earnings.description",
        icon: "Wallet",
      },
    ] satisfies NavMenuItem[]).filter(
      (item) => PROMOTER_PAGES_VISIBLE || !promoterOnlyPages.has(item.slug),
    ),
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
    labelKey: "nav.ggboost",
    // The landing page for the mobile heading link. No directory link at the
    // foot of the desktop panel: its first entry already is the Task Center.
    href: "/tasks",
    menu: ggboostMenuGroups,
  },
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
