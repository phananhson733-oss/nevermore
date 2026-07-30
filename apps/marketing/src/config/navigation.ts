// @input  — @/types 中的 NavItem / FooterLink 类型
// @output — headerNavItems / footerResourceLinks / footerLegalLinks 导航数据
// @pos    — 静态配置，供 Header 和 Footer 组件消费
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import type { NavItem, FooterLink } from "@/types";

export const headerNavItems: NavItem[] = [
  { labelKey: "nav.tools", href: "/tools" },
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
