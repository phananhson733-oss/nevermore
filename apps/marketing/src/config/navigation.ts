// @input  — @/types 中的 NavItem / FooterLink 类型
// @output — headerNavItems / footerResourceLinks / footerLegalLinks 导航数据
// @pos    — 静态配置，供 Header 和 Footer 组件消费
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import type { NavItem, FooterLink, NavMenuGroup } from "@/types";

/**
 * The free tools surfaced in the header submenu.
 *
 * Grouped the same way the /tools hub groups them, because the two are the same
 * catalogue seen from two places — `navigation.test.ts` fails if a tool appears
 * in one and not the other, so adding a tool cannot silently skip the header.
 * The calculators are deliberately absent: they are supporting utilities rather
 * than entry points, and the hub does not list them either.
 */
export const toolsMenuGroups: NavMenuGroup[] = [
  {
    labelKey: "nav.toolsMenu.diagnoseGroup",
    items: [
      {
        slug: "seo-quick-wins",
        labelKey: "nav.toolsMenu.seoQuickWins.label",
        descriptionKey: "nav.toolsMenu.seoQuickWins.description",
        icon: "Zap",
      },
      {
        slug: "internal-link-audit",
        labelKey: "nav.toolsMenu.internalLinkAudit.label",
        descriptionKey: "nav.toolsMenu.internalLinkAudit.description",
        icon: "Network",
      },
      {
        slug: "traffic-drop-diagnosis",
        labelKey: "nav.toolsMenu.trafficDropDiagnosis.label",
        descriptionKey: "nav.toolsMenu.trafficDropDiagnosis.description",
        icon: "TrendingDown",
      },
      {
        slug: "seo-audit",
        labelKey: "nav.toolsMenu.seoAudit.label",
        descriptionKey: "nav.toolsMenu.seoAudit.description",
        icon: "ScanSearch",
      },
    ],
  },
  {
    labelKey: "nav.toolsMenu.planGroup",
    items: [
      {
        slug: "hidden-keywords",
        labelKey: "nav.toolsMenu.hiddenKeywords.label",
        descriptionKey: "nav.toolsMenu.hiddenKeywords.description",
        icon: "Compass",
      },
    ],
  },
];

export const headerNavItems: NavItem[] = [
  { labelKey: "nav.tools", href: "/tools", menu: toolsMenuGroups },
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
