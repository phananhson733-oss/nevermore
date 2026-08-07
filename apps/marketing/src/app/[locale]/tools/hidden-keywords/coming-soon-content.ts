// @input  -- locale
// @output -- truthful coming-soon and waitlist copy for the hidden-keywords page
// @pos    -- copy boundary for a tool that is announced but has not shipped

export interface HiddenKeywordsComingSoonContent {
  /**
   * Stays "Keyword Opportunity Map" per the 2026-08-06 naming table.
   * `+ Prompt` joins the formal name only after that capability ships.
   */
  readonly metaTitle: string;
  readonly statusLabel: string;
  readonly availabilityTitle: string;
  readonly availabilityBody: string;
  readonly waitlistTitle: string;
  readonly waitlistBody: string;
  readonly submitLabel: string;
  readonly successTitle: string;
  readonly successDesc: string;
  readonly alternativesLabel: string;
  readonly alternativesBody: string;
}

const EN: HiddenKeywordsComingSoonContent = {
  metaTitle: "Keyword Opportunity Map",
  statusLabel: "Coming soon",
  availabilityTitle: "This tool is not available yet",
  availabilityBody:
    "The Keyword Opportunity Map has not shipped as a public tool. There is nothing to run on this page today — no input and no report. The sections below describe how it will work once it opens.",
  waitlistTitle: "Get an email when it opens",
  waitlistBody:
    "Leave your work email and we will notify you when the Keyword Opportunity Map is ready to use.",
  submitLabel: "Join the waitlist",
  successTitle: "You're on the list",
  successDesc:
    "We will email you when the Keyword Opportunity Map opens. Nothing to do until then.",
  alternativesLabel: "While you wait",
  alternativesBody:
    "Two public tools already run on any public URL, with nothing to connect.",
};

const ZH: HiddenKeywordsComingSoonContent = {
  metaTitle: "Keyword Opportunity Map",
  statusLabel: "即将上线",
  availabilityTitle: "该工具尚未开放",
  availabilityBody:
    "关键词机会地图的公开版本尚未上线。此页面目前没有可运行的功能——没有输入框，也不会生成报告。下方内容介绍的是它开放后的工作方式。",
  waitlistTitle: "开放时收到邮件通知",
  waitlistBody: "留下工作邮箱，关键词机会地图开放使用时我们会邮件通知你。",
  submitLabel: "加入等待列表",
  successTitle: "已加入等待列表",
  successDesc: "关键词机会地图开放时，我们会通过邮件通知你。在那之前无需任何操作。",
  alternativesLabel: "等待期间",
  alternativesBody: "这两个公开工具已可对任意公开 URL 运行，无需连接任何账号。",
};

export function getHiddenKeywordsComingSoonContent(
  locale: string,
): HiddenKeywordsComingSoonContent {
  return locale === "zh" ? ZH : EN;
}
