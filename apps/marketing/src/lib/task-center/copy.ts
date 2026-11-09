// @input  -- the page locale ("en" or "zh")
// @output -- every visitor-facing string of /tasks (the clip grid and its drama dialog), /tasks/<id>, /promotions, /earnings and the reader's drama page /watch/<id>, audience, genre, clip-type and platform labels, the 收费起始 value, a clip's title with machine names (UUIDs, hashes) left out, the Chinese labels the admin pages share, and the promo link's URL
// @pos    -- task center copy, kept beside the code like the waitlist page's; the admin pages are Chinese only
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  MAX_ACCOUNTS_PER_USER,
  type AccountStatus,
  type ClaimChannel,
  type ClipType,
  type DramaAudience,
  type LookupPlatform,
  type PromoChannel,
} from "./contracts.ts";

const en = {
  tasksTitle: "Task Center",
  tasksSubtitle:
    "Browse the clips our team cut, get your own promo link in one click, and post them to TikTok or Facebook.",
  allOption: "All",
  searchPlaceholder: "Search by title",
  apply: "Apply",
  noResults: "No dramas match these filters.",
  noneYet: "No dramas are listed yet.",
  unavailable: "The task center is unavailable right now. Please try again later.",
  episodes: (n: number) => `${n} episodes`,
  episodesUnknown: "Episodes —",
  freeEpisodes: (n: number) => `first ${n} free`,
  allFree: "all free",
  paidFromFirst: "paid from episode 1",
  promoters: (n: number) => `${n} promoting`,
  previous: "Previous",
  next: "Next",
  pageOf: (page: number, pages: number) => `Page ${page} of ${pages}`,
  back: "All tasks",
  platform: "Platform",
  language: "Language",
  listedOn: "Listed",
  episodesLabel: "Episodes",
  payStartLabel: "Paid from",
  fromEpisode: (n: number) => `Episode ${n}`,
  allFreeShort: "All free",
  promotersLabel: "Promoters",
  synopsis: "Synopsis",
  contents: "Episodes",
  contentsUnknown: "The episode count has not been provided.",
  lockedNote: "Episodes with a lock are paid on the platform.",
  clips: "Free clips to download",
  clipsBody: "Click a number to download that clip.",
  allClips: "All clips of this drama",
  clipLabel: (n: number, title: string | null, size: string) =>
    title === null ? `Download clip ${n}, ${size}` : `Download clip ${n}: ${title}, ${size}`,
  previewClips: "Preview the clips",
  noClips: "No clips have been uploaded for this drama yet.",
  signInForClips: "Sign in to preview and download the clips.",
  download: "Download",
  downloadThis: "Download this clip",
  promote: "Promo links",
  promoteBody:
    "Your own link for this drama, the same on TikTok, Facebook or anywhere else. Every click counts under your name, and when the platform settles, orders are matched back to your link.",
  signInToPromote: "Sign in with Google to get your promo link.",
  signIn: "Sign in",
  getLink: "Get my promo link",
  claiming: "Getting your link…",
  claimFailed: "That did not work. Please try again.",
  dramaLink: "Drama link",
  dramaLinkBody:
    "Opens this drama's page on our site, with its cover, story and trailer. Put it in the video's caption or pin it in the comments.",
  previewPage: "See the page your link opens",
  linkAfterClaim: "Shows here once you get your link.",
  whitelistTitle: "Whitelist your accounts",
  whitelistBody: "Submit the TikTok and Facebook accounts you post from, so our team can whitelist them on the platform.",
  whitelistAction: "Submit accounts",
  copy: "Copy",
  copied: "Copied",
  howTo: "How it works",
  howToSteps: [
    "Download the clips.",
    "Get your promo link and copy it.",
    "Post the clips on TikTok or Facebook, with your link in the caption or a pinned comment. It opens the drama's page on our site.",
    "After each settlement, orders through your link are credited to you and show on My Earnings.",
  ] as readonly string[],
  tabTasks: "Task Center",
  tabPromotions: "My Promotions",
  tabEarnings: "My Earnings",
  promotionsTitle: "My Promotions",
  promotionsSubtitle:
    "Every drama you took links for, how often each link was followed, and the accounts you post from.",
  signInForPromotions: "Sign in with Google to see your promo links and accounts.",
  anyChannel: "Any",
  accountsTitle: "Accounts to whitelist",
  accountsBody:
    "Add the TikTok and Facebook accounts you post from. Our team whitelists them on the platform; the status shows here.",
  accountHandle: "Account (@handle or profile link)",
  submitAccount: "Submit",
  submitting: "Submitting…",
  accountFailed: "That did not work. Please try again.",
  tooManyAccounts: `You can have up to ${MAX_ACCOUNTS_PER_USER} accounts on file. Withdraw one first.`,
  noAccounts: "No accounts submitted yet.",
  accountStatus: {
    submitted: "Waiting for review",
    whitelisted: "Whitelisted",
    rejected: "Not approved",
  } as Readonly<Record<AccountStatus, string>>,
  withdraw: "Withdraw",
  submittedOn: "Submitted",
  earningsTitle: "My Earnings",
  earningsSubtitle:
    "Figures come from the settlement reports our team imports. Anything a report did not include is shown as —.",
  signInForEarnings: "Sign in with Google to see your earnings.",
  totals: "Totals",
  income: "Income",
  orders: "Orders",
  adAmount: "Ad amount",
  // Earliest and latest only: a day in between may be missing from every file.
  period: (first: string, last: string) => `Settlement days: earliest ${first}, latest ${last}`,
  noSettlement: "No settlement data has been imported for your links yet.",
  byPlatform: "By platform",
  myLinks: "My promo links",
  noLinks: "You have not taken a promo link yet.",
  browseTasks: "Browse the task center",
  drama: "Drama",
  channel: "Channel",
  clicks: "Clicks",
  claimedOn: "Claimed",
  partialValue: (value: string) => `${value} (partial)`,
  partialNote:
    "Partial: the platform reported this figure for some days and not others, so the total covers only the days it reported.",
  searchClips: "Search by drama or clip",
  searchLabel: "Search",
  genreField: "Genre",
  tagField: "Tag",
  audience: { female: "Female", male: "Male" } as Readonly<Record<DramaAudience, string>>,
  clipType: {
    recap: "Recap",
    mixcut: "Mixcut",
    highlight: "Highlight",
    trailer: "Trailer",
    episode: "Full episode",
  } as Readonly<Record<ClipType, string>>,
  hotThisWeek: "Hot this week",
  hotNote: "One of the three dramas the most people took a link for in the last 7 days.",
  noClipResults: "No clips match these filters.",
  noClipsListed: "No clips are listed yet.",
  playClip: (title: string) => `Play ${title}`,
  viewDrama: "View the drama",
  close: "Close",
  watchFull: (platform: string) => `Watch the full drama on ${platform}`,
  watchTrailer: "Trailer",
  watchUnavailable: "This page cannot be shown right now. Please try again later.",
};

export type TaskCopy = typeof en;

const zh: TaskCopy = {
  tasksTitle: "任务中心",
  tasksSubtitle: "挑运营剪好的素材，一键领取专属推广链接，下载后发到 TikTok 或 Facebook。",
  allOption: "全部",
  searchPlaceholder: "按剧名搜索",
  apply: "筛选",
  noResults: "没有符合条件的短剧。",
  noneYet: "还没有上架的短剧。",
  unavailable: "任务中心暂时不可用，请稍后再试。",
  episodes: (n: number) => `共 ${n} 集`,
  episodesUnknown: "集数 —",
  freeEpisodes: (n: number) => `前 ${n} 集免费`,
  allFree: "全部免费",
  paidFromFirst: "第 1 集起付费",
  promoters: (n: number) => `${n} 人推广`,
  previous: "上一页",
  next: "下一页",
  pageOf: (page: number, pages: number) => `第 ${page} / ${pages} 页`,
  back: "全部任务",
  platform: "平台",
  language: "语言",
  listedOn: "上架时间",
  episodesLabel: "集数",
  payStartLabel: "收费起始",
  fromEpisode: (n: number) => `第 ${n} 集`,
  allFreeShort: "全部免费",
  promotersLabel: "推广人数",
  synopsis: "简介",
  contents: "目录",
  contentsUnknown: "还没有提供集数。",
  lockedNote: "带锁的集数在平台上需要付费观看。",
  clips: "免费素材下载",
  clipsBody: "点数字下载对应的素材。",
  allClips: "这部剧的全部素材",
  clipLabel: (n: number, title: string | null, size: string) =>
    title === null ? `下载素材 ${n}，${size}` : `下载素材 ${n}：${title}，${size}`,
  previewClips: "预览素材",
  noClips: "这部剧还没有上传素材。",
  signInForClips: "登录后可以预览和下载素材。",
  download: "下载",
  downloadThis: "下载这条素材",
  promote: "推广链接",
  promoteBody: "这部剧给你的专属链接，TikTok、Facebook 都用这一条。每次点击都记在你名下，平台结算时按你的链接把订单对回到你。",
  signInToPromote: "用 Google 登录后领取推广链接。",
  signIn: "登录",
  getLink: "一键获取推广链接",
  claiming: "获取中…",
  claimFailed: "没有成功，请再试一次。",
  dramaLink: "短剧推广链接",
  dramaLinkBody: "点开是这部剧在我们站上的页面，有封面、简介和预告片。适合放在视频文案里或评论区置顶。",
  previewPage: "看看链接打开的页面",
  linkAfterClaim: "领取后显示在这里。",
  whitelistTitle: "账号报白",
  whitelistBody: "发布用的 TikTok、Facebook 账号，先提交给运营去平台报白。",
  whitelistAction: "去提交账号",
  copy: "复制",
  copied: "已复制",
  howTo: "使用说明",
  howToSteps: [
    "下载素材。",
    "领取并复制你的推广链接。",
    "把素材发到 TikTok 或 Facebook，推广链接放视频文案或评论区置顶。读者点开先到我们站上这部剧的页面。",
    "每次平台结算后，你的链接带来的订单会记到你名下，在「我的收益」里查看。",
  ],
  tabTasks: "任务中心",
  tabPromotions: "我的推广",
  tabEarnings: "我的收益",
  promotionsTitle: "我的推广",
  promotionsSubtitle: "你领过链接的每部剧、每条链接被点开的次数，以及你用来发布的账号。",
  signInForPromotions: "用 Google 登录后查看你的推广链接和账号。",
  anyChannel: "通用",
  accountsTitle: "账号报白",
  accountsBody: "填上你用来发布的 TikTok、Facebook 账号，运营会去平台上报白，进度在这里看。",
  accountHandle: "账号（@用户名或主页链接）",
  submitAccount: "提交",
  submitting: "提交中…",
  accountFailed: "没有成功，请再试一次。",
  tooManyAccounts: `最多提交 ${MAX_ACCOUNTS_PER_USER} 个账号，先撤回一个再加。`,
  noAccounts: "还没有提交账号。",
  accountStatus: { submitted: "待报白", whitelisted: "已报白", rejected: "未通过" },
  withdraw: "撤回",
  submittedOn: "提交时间",
  earningsTitle: "我的收益",
  earningsSubtitle: "数字来自运营导入的平台结算数据，结算里没有的项目显示为 —。",
  signInForEarnings: "用 Google 登录后查看你的收益。",
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
  searchClips: "按剧名或素材名搜索",
  searchLabel: "搜索",
  genreField: "题材",
  tagField: "标签",
  audience: { female: "女频", male: "男频" },
  clipType: {
    recap: "解说",
    mixcut: "混剪",
    highlight: "高光",
    trailer: "预告",
    episode: "整集",
  },
  hotThisWeek: "本周爆款",
  hotNote: "最近 7 天领取推广链接人数最多的 3 部剧之一。",
  noClipResults: "没有符合条件的素材。",
  noClipsListed: "还没有上架的素材。",
  playClip: (title: string) => `播放 ${title}`,
  viewDrama: "查看这部剧",
  close: "关闭",
  watchFull: (platform: string) => `去 ${platform} 看全集`,
  watchTrailer: "预告片",
  watchUnavailable: "页面暂时打不开，请稍后再试。",
};

export function taskCopy(locale: string): TaskCopy {
  return locale === "zh" ? zh : en;
}

/** Admin pages are Chinese only. */
export const AUDIENCE_LABELS_ZH = zh.audience;
export const CLIP_TYPE_LABELS_ZH = zh.clipType;

/** A genre slug as a label: werewolf → Werewolf, second-chance → Second Chance. */
export function genreLabel(slug: string): string {
  return slug
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}


/** How each platform the 选剧台 lookup knows writes its own name. */
export const PLATFORM_LABELS: Readonly<Record<LookupPlatform, string>> = {
  reelshort: "ReelShort",
  dramabox: "DramaBox",
  shortmax: "ShortMax",
  moboreels: "MoboReels",
  flickreels: "FlickReels",
  kalostv: "KalosTV",
  netshort: "NetShort",
  goodshort: "GoodShort",
  flareflow: "FlareFlow",
  stardusttv: "StardustTV",
  yourchannel: "YourChannel",
};

/** A platform slug as its name; one typed by hand shows as itself. */
export function platformLabel(slug: string): string {
  return (PLATFORM_LABELS as Readonly<Record<string, string>>)[slug] ?? slug;
}

export const DRAMA_STATUS_LABELS = { draft: "草稿", published: "上架中", archived: "已下架" } as const;

export const ACCOUNT_STATUS_LABELS: Readonly<Record<AccountStatus, string>> = {
  submitted: "待报白",
  whitelisted: "已报白",
  rejected: "未通过",
};

export const CHANNEL_LABELS: Readonly<Record<PromoChannel, string>> = {
  tiktok: "TikTok",
  facebook: "Facebook",
  instagram: "Instagram",
  youtube: "YouTube",
};

/** "all" is today's one link per drama; the named channels are older per-channel codes. */
export function channelLabel(channel: ClaimChannel, copy: TaskCopy): string {
  return channel === "all" ? copy.anyChannel : CHANNEL_LABELS[channel];
}

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

/**
 * "共 60 集 · 前 9 集免费": what the platform shows free, from the first paid
 * episode. Either half is left out when unknown; null when both are.
 */
export function episodeLine(episodes: number | null, payStart: number | null, copy: TaskCopy): string | null {
  const parts: string[] = [];
  if (episodes !== null) parts.push(copy.episodes(episodes));
  if (payStart !== null) {
    if (payStart <= 1) parts.push(copy.paidFromFirst);
    else if (episodes !== null && payStart > episodes) parts.push(copy.allFree);
    else parts.push(copy.freeEpisodes(payStart - 1));
  }
  return parts.length === 0 ? null : parts.join(" · ");
}

/** 收费起始 as a value: the first paid episode, or 全部免费 when it lies past the last one; null when unknown. */
export function paidFrom(episodes: number | null, payStart: number | null, copy: TaskCopy): string | null {
  if (payStart === null) return null;
  if (episodes !== null && payStart > episodes) return copy.allFreeShort;
  return copy.fromEpisode(Math.max(1, payStart));
}

/**
 * A clip's title as promoters should see it, or null when it is only a machine
 * name. Titles default to the uploaded file's name, and files saved from a
 * platform are often named by a UUID or a hash, which tells a promoter nothing.
 */
export function clipTitle(title: string): string | null {
  const name = title.trim();
  if (name === "" || name.toLowerCase() === "clip") return null;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(name)) return null;
  if (/^[0-9a-f]{16,}$/i.test(name)) return null;
  return name;
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The promo link we hand out: opens the drama's page on our site, /watch/<id>. */
export function promoLink(origin: string, code: string): string {
  return `${origin}/t/${code}`;
}
