// @input  -- a report item's id (action or check), locale, optional GSC property
// @output -- the next-step link that item carries, or null when it carries none
// @pos    -- the traffic-drop report's outbound link table; keys are host items, not pages
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { TrafficCheckStatus } from "@sf/public-tools";

import { localePath } from "../locale-path";

export interface TrafficDropLink {
  readonly href: string;
  /** True for links that leave gengrowth.ai; rendered with a new tab. */
  readonly external: boolean;
  readonly label: string;
  readonly detail: string | null;
}

type LinkLocale = "en" | "zh";

interface LinkCopy {
  readonly label: string;
  readonly detail: string | null;
}

interface InternalLinkDefinition {
  readonly path: string;
  readonly copy: Readonly<Record<LinkLocale, LinkCopy>>;
}

function linkLocale(locale: string): LinkLocale {
  return locale === "zh" ? "zh" : "en";
}

/**
 * Links appended INSIDE existing action items (交办 5a). Keyed by action id so a
 * link can never render without the item whose text motivates it — the report
 * wrote the next step, these give the step somewhere to go.
 */
const ACTION_LINKS: Readonly<Record<string, InternalLinkDefinition>> = {
  isolate_stage_one_ctr: {
    path: "/tools/seo-quick-wins",
    copy: {
      en: {
        label: "Run SEO Quick Wins on this property",
        detail:
          "It reads the same Search Console property and lists the queries whose click-through sits below your own baseline.",
      },
      zh: {
        label: "在同一个资源上运行 SEO Quick Wins",
        detail:
          "它读取同一个 Search Console 资源，列出点击率低于你自己基线的查询。",
      },
    },
  },
  pull_deploy_logs: {
    path: "/agents/seo",
    copy: {
      en: {
        label: "Run SEO Agent on this site",
        detail:
          "It uses public-page crawl evidence and needs no Search Console connection. A verified GenGrowth account is required before the crawl, and the run is not saved.",
      },
      zh: {
        label: "对这个站点运行 SEO Agent",
        detail:
          "它使用公开页面抓取证据，无需连接 Search Console；抓取前必须验证 GenGrowth 账号，本次运行也不会保存。",
      },
    },
  },
};

/**
 * Links on "Cannot check" rows only. A computed check has no gap to point at,
 * so `hit`/`clear` return null by construction rather than by caller courtesy.
 */
const CHECK_LINKS: Readonly<Record<string, InternalLinkDefinition>> = {
  single_page_dominated_decline: {
    path: "/agents/tech",
    copy: {
      en: {
        label: "Run the technical focus on this site",
        detail:
          "It reviews internal-link evidence from public HTML without a Search Console connection. A verified account is required before the crawl, and the run is not saved.",
      },
      zh: {
        label: "对这个站点运行技术焦点检查",
        detail:
          "它无需连接 Search Console，基于公开 HTML 检查内链证据；抓取前必须验证账号，本次运行也不会保存。",
      },
    },
  },
};

const GSC_CONSOLE_URL = "https://search.google.com/search-console";

const GSC_LINK_COPY: Readonly<Record<LinkLocale, LinkCopy>> = {
  en: { label: "Open the Queries view in Search Console", detail: null },
  zh: { label: "打开 Search Console 效果报告的查询视图", detail: null },
};

function internalLink(
  definition: InternalLinkDefinition,
  locale: string,
): TrafficDropLink {
  const copy = definition.copy[linkLocale(locale)];
  return {
    href: localePath(locale, definition.path),
    external: false,
    label: copy.label,
    detail: copy.detail,
  };
}

/** The link an action item carries, or null — most actions carry none. */
export function trafficDropActionLink(
  actionId: string,
  locale: string,
): TrafficDropLink | null {
  const definition = ACTION_LINKS[actionId];
  return definition === undefined ? null : internalLink(definition, locale);
}

/**
 * The link a check row carries, or null. Only `not_available` rows link out:
 * the row itself says the data lives elsewhere, and the link is that elsewhere.
 *
 * `property` is the Search Console property identifier when the caller has it;
 * without it the deep link cannot name a resource, so the link falls back to
 * the console's entry page and the visitor picks the property there.
 */
export function trafficDropCheckLink(
  checkId: string,
  status: TrafficCheckStatus,
  locale: string,
  property: string | null,
): TrafficDropLink | null {
  if (status !== "not_available") return null;

  if (checkId === "decline_concentration") {
    const copy = GSC_LINK_COPY[linkLocale(locale)];
    return {
      href:
        property === null || property === ""
          ? GSC_CONSOLE_URL
          : `${GSC_CONSOLE_URL}/performance/search-analytics?resource_id=${encodeURIComponent(property)}`,
      external: true,
      label: copy.label,
      detail: copy.detail,
    };
  }

  const definition = CHECK_LINKS[checkId];
  return definition === undefined ? null : internalLink(definition, locale);
}
