// @input  -- the page locale ("en" or "zh")
// @output -- every visitor-facing string of /tasks, /tasks/<id> and /earnings
// @pos    -- task center copy, kept beside the code like the waitlist page's; the admin pages are Chinese only
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { PromoChannel } from "./contracts.ts";

const en = {
  tasksTitle: "Task Center",
  tasksSubtitle:
    "Pick a short drama, claim a promo link for the channel you post on, and use the clips our team cut for it.",
  allPlatforms: "All platforms",
  allLanguages: "All languages",
  searchPlaceholder: "Search by title",
  sortNewest: "Newest",
  sortPromoters: "Most promoters",
  apply: "Apply",
  noResults: "No dramas match these filters.",
  noneYet: "No dramas are listed yet.",
  unavailable: "The task center is unavailable right now. Please try again later.",
  episodes: (n: number) => `${n} episodes`,
  episodesUnknown: "Episodes —",
  promoters: (n: number) => `${n} promoting`,
  previous: "Previous",
  next: "Next",
  pageOf: (page: number, pages: number) => `Page ${page} of ${pages}`,
  back: "All tasks",
  platform: "Platform",
  language: "Language",
  listedOn: "Listed",
  payStart: "Paid from",
  payStartValue: (n: number) => `episode ${n}`,
  synopsis: "Synopsis",
  contents: "Episodes",
  contentsUnknown: "The episode count has not been provided.",
  lockedNote: "Episodes with a lock are paid on the platform.",
  clips: "Clips to post",
  noClips: "No clips have been uploaded for this drama yet.",
  signInForClips: "Sign in to preview and download the clips.",
  download: "Download",
  promote: "Promote",
  promoteBody:
    "Each channel gets its own link and code, so results can be matched back to you when the platform reports them.",
  signInToPromote: "Sign in with Google to claim a promo link.",
  signIn: "Sign in",
  claim: (channel: string) => `Promote on ${channel}`,
  claiming: "Claiming…",
  claimFailed: "That did not work. Please try again.",
  yourLink: "Your link",
  yourCode: "Code",
  copy: "Copy",
  copied: "Copied",
  earningsTitle: "My Earnings",
  earningsSubtitle:
    "Figures come from the settlement reports our team imports. Anything a report did not include is shown as —.",
  signInForEarnings: "Sign in with Google to see your promo links and earnings.",
  totals: "Totals",
  income: "Income",
  orders: "Orders",
  adAmount: "Ad amount",
  // Earliest and latest only: a day in between may be missing from every file.
  period: (first: string, last: string) => `Settlement days: earliest ${first}, latest ${last}`,
  noSettlement: "No settlement data has been imported for your links yet.",
  byPlatform: "By platform",
  myLinks: "My promo links",
  noLinks: "You have not claimed any promo links yet.",
  browseTasks: "Browse the task center",
  drama: "Drama",
  channel: "Channel",
  clicks: "Clicks",
  claimedOn: "Claimed",
  partialValue: (value: string) => `${value} (partial)`,
  partialNote:
    "Partial: the platform reported this figure for some days and not others, so the total covers only the days it reported.",
  promotersLabel: "Promoters",
};

export type TaskCopy = typeof en;

const zh: TaskCopy = {
  tasksTitle: "任务中心",
  tasksSubtitle: "挑一部短剧，按你发布的渠道领取专属推广链接，配合运营剪好的素材去发。",
  allPlatforms: "全部平台",
  allLanguages: "全部语言",
  searchPlaceholder: "按剧名搜索",
  sortNewest: "最新上架",
  sortPromoters: "推广人数",
  apply: "筛选",
  noResults: "没有符合条件的短剧。",
  noneYet: "还没有上架的短剧。",
  unavailable: "任务中心暂时不可用，请稍后再试。",
  episodes: (n: number) => `共 ${n} 集`,
  episodesUnknown: "集数 —",
  promoters: (n: number) => `${n} 人推广`,
  previous: "上一页",
  next: "下一页",
  pageOf: (page: number, pages: number) => `第 ${page} / ${pages} 页`,
  back: "全部任务",
  platform: "平台",
  language: "语言",
  listedOn: "上架时间",
  payStart: "收费起始",
  payStartValue: (n: number) => `第 ${n} 集`,
  synopsis: "简介",
  contents: "目录",
  contentsUnknown: "还没有提供集数。",
  lockedNote: "带锁的集数在平台上需要付费观看。",
  clips: "推广素材",
  noClips: "这部剧还没有上传素材。",
  signInForClips: "登录后可以预览和下载素材。",
  download: "下载",
  promote: "去推广",
  promoteBody: "每个渠道单独一条链接和口令码，平台结算时才能按码对回到你。",
  signInToPromote: "用 Google 登录后领取推广链接。",
  signIn: "登录",
  claim: (channel: string) => `推广到 ${channel}`,
  claiming: "领取中…",
  claimFailed: "没有成功，请再试一次。",
  yourLink: "推广链接",
  yourCode: "口令码",
  copy: "复制",
  copied: "已复制",
  earningsTitle: "我的收益",
  earningsSubtitle: "数字来自运营导入的平台结算数据，结算里没有的项目显示为 —。",
  signInForEarnings: "用 Google 登录后查看你的推广链接和收益。",
  totals: "汇总",
  income: "收益",
  orders: "订单数",
  adAmount: "广告金额",
  period: (first: string, last: string) => `结算日期：最早 ${first}，最晚 ${last}`,
  noSettlement: "你的推广链接还没有导入结算数据。",
  byPlatform: "按平台",
  myLinks: "我的推广链接",
  noLinks: "你还没有领取推广链接。",
  browseTasks: "去任务中心看看",
  drama: "短剧",
  channel: "渠道",
  clicks: "点击",
  claimedOn: "领取时间",
  partialValue: (value: string) => `${value}（部分）`,
  partialNote: "部分：平台只给了其中一些天的这一项，合计只算了给了的那些天。",
  promotersLabel: "推广人数",
};

export function taskCopy(locale: string): TaskCopy {
  return locale === "zh" ? zh : en;
}

/** Admin pages are Chinese only. */
export const DRAMA_STATUS_LABELS = { draft: "草稿", published: "上架中", archived: "已下架" } as const;

export const CHANNEL_LABELS: Readonly<Record<PromoChannel, string>> = {
  tiktok: "TikTok",
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
};

/** Plain language names for the codes admins enter; an unknown code shows as itself. */
export function languageName(code: string, locale: string): string {
  try {
    return new Intl.DisplayNames([locale === "zh" ? "zh-CN" : "en"], { type: "language" }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Exact minor units, as the decimal string the database summed, back to a
 * currency string, or "—" when unknown. The decimal point is placed in the
 * string and Intl formats the string, so no float rounds a cent however large.
 */
export function formatMoney(minor: string | null, currency: string, locale: string): string {
  if (minor === null) return "—";
  if (!/^\d+$/.test(minor)) throw new RangeError(`not a minor-unit amount: ${minor}`);
  const format = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US", {
    style: "currency",
    currency,
  });
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2;
  const padded = minor.padStart(digits + 1, "0");
  const decimal = digits === 0 ? padded : `${padded.slice(0, -digits)}.${padded.slice(-digits)}`;
  return format.format(decimal as `${number}`);
}

/** A count, or a summed count as the database's decimal string; "—" when unknown. */
export function formatCount(value: number | string | null, locale: string): string {
  if (value === null) return "—";
  const format = new Intl.NumberFormat(locale === "zh" ? "zh-CN" : "en-US");
  return typeof value === "string" ? format.format(value as `${number}`) : format.format(value);
}

export function formatDay(iso: string | null, locale: string): string {
  if (iso === null) return "—";
  return new Intl.DateTimeFormat(locale === "zh" ? "zh-CN" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(iso));
}

export function promoLink(origin: string, code: string): string {
  return `${origin}/t/${code}`;
}
