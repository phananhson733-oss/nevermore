// @input  -- the page locale ("en" or "zh")
// @output -- every visitor-facing string of /tasks (the drama grid and its drama dialog), /tasks/<id>, /promotions, /earnings and the reader's drama page /watch/<id>, audience, genre, clip-type and platform labels, a clip's title with machine names (UUIDs, hashes) left out, the Chinese labels the admin pages share, and the two promo links' URLs (/t/<code> and /t/<code>/go)
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
    "Browse the clips our team cut, open a drama to get your own promo links, and post them to TikTok or Facebook.",
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
  synopsis: "Synopsis",
  contents: "Episodes",
  contentsUnknown: "The episode count has not been provided.",
  lockedNote: "Episodes with a lock are paid on the platform.",
  clips: "Free clips to download",
  clipsBody: "Click a number to download that clip.",
  seriesClips: "Series clips",
  seriesClipsBody: "Click a number to play that clip, then download it under the player.",
  clipCount: (n: number) => (n === 1 ? "1 clip" : `${n} clips`),
  playNumbered: (n: number, title: string | null, size: string) =>
    title === null ? `Play clip ${n}, ${size}` : `Play clip ${n}: ${title}, ${size}`,
  clipLabel: (n: number, title: string | null, size: string) =>
    title === null ? `Download clip ${n}, ${size}` : `Download clip ${n}: ${title}, ${size}`,
  previewClips: "Preview the clips",
  noClips: "No clips have been uploaded for this drama yet.",
  signInForClips: "Sign in to preview and download the clips.",
  download: "Download",
  downloadThis: "Download this clip",
  promote: "Your promo links",
  promoteBody:
    "Made for you when you open this drama, the same on TikTok, Facebook or anywhere else. Clicks on either link count under your name, and when the platform settles, orders are matched back to your links.",
  signInToPromote: "Sign in with Google and your promo links are made for you.",
  signIn: "Sign in",
  claiming: "Making your links…",
  claimFailed: "Your links could not be made.",
  retry: "Try again",
  dramaLink: "Promo link",
  dramaLinkBody:
    "Readers land on this drama's page on GenGrowth, with its cover, story and trailer, and go on to the platform from there.",
  resourceLink: "Resource link",
  resourceLinkBody:
    "Readers go straight to this drama on the platform. Until the drama's platform link is set up, it opens the drama's page on GenGrowth.",
  previewPage: "See the page the promo link opens",
  linkAfterSignIn: "Shows here once you sign in.",
  copy: "Copy",
  copied: "Copied",
  howTo: "How it works",
  howToSteps: [
    "Download the clips.",
    "Copy your promo link or resource link. Both are made for you when you open the drama.",
    "Post the clips on TikTok or Facebook, with the link in the caption or a pinned comment.",
    "After each settlement, orders through your link are credited to you and show on My Earnings.",
  ] as readonly string[],
  tabTasks: "Task Center",
  tabPromotions: "My Promotions",
  tabEarnings: "My Earnings",
  promotionsTitle: "My Promotions",
  promotionsSubtitle:
    "Every drama you have links for, how often they were followed, and the accounts you post from.",
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
  noLinks: "You have no promo links yet. Open a drama and yours are made for you.",
  browseTasks: "Browse the task center",
  drama: "Drama",
  channel: "Channel",
  clicks: "Clicks",
  claimedOn: "Since",
  partialValue: (value: string) => `${value} (partial)`,
  partialNote:
    "Partial: the platform reported this figure for some days and not others, so the total covers only the days it reported.",
  searchClips: "Search by drama or clip",
  searchLabel: "Search",
  theaterField: "Platform",
  genreField: "Genre",
  tagField: "Tag",
  tagPlaceholder: "Type or pick a tag",
  tagNoMatch: "No matching tags",
  audience: { female: "Female", male: "Male" } as Readonly<Record<DramaAudience, string>>,
  clipType: {
    recap: "Recap",
    mixcut: "Mixcut",
    highlight: "Highlight",
    trailer: "Trailer",
    episode: "Full episode",
  } as Readonly<Record<ClipType, string>>,
  hotThisWeek: "Hot this week",
  hotNote: "One of the three dramas the most promoters got links for in the last 7 days.",
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
  tasksSubtitle: "挑运营剪好的素材，打开剧就有你的专属推广链接，下载后发到 TikTok 或 Facebook。",
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
  synopsis: "简介",
  contents: "目录",
  contentsUnknown: "还没有提供集数。",
  lockedNote: "带锁的集数在平台上需要付费观看。",
  clips: "免费素材下载",
  clipsBody: "点数字下载对应的素材。",
  seriesClips: "系列资源",
  seriesClipsBody: "点数字切换到对应的素材，在播放器下面下载。",
  clipCount: (n: number) => `${n} 条素材`,
  playNumbered: (n: number, title: string | null, size: string) =>
    title === null ? `播放素材 ${n}，${size}` : `播放素材 ${n}：${title}，${size}`,
  clipLabel: (n: number, title: string | null, size: string) =>
    title === null ? `下载素材 ${n}，${size}` : `下载素材 ${n}：${title}，${size}`,
  previewClips: "预览素材",
  noClips: "这部剧还没有上传素材。",
  signInForClips: "登录后可以预览和下载素材。",
  download: "下载",
  downloadThis: "下载这条素材",
  promote: "我的推广链接",
  promoteBody: "打开这部剧时自动为你生成，TikTok、Facebook 都能用。两条链接的点击都记在你名下，平台结算时按你的链接把订单对回到你。",
  signInToPromote: "用 Google 登录后自动生成你的推广链接。",
  signIn: "登录",
  claiming: "正在生成你的链接…",
  claimFailed: "链接没有生成成功。",
  retry: "重试",
  dramaLink: "推广链接",
  dramaLinkBody: "用户点击后打开这部剧在 GenGrowth 的介绍页（封面、简介、预告片），再从那里去平台看全集。",
  resourceLink: "资源推广链接",
  resourceLinkBody: "用户点击后直接跳到平台上的这部剧。平台链接还没配好的剧，先打开 GenGrowth 的介绍页。",
  previewPage: "看看推广链接打开的页面",
  linkAfterSignIn: "登录后显示在这里。",
  copy: "复制",
  copied: "已复制",
  howTo: "使用说明",
  howToSteps: [
    "下载素材。",
    "复制推广链接或资源推广链接，打开剧时已自动生成。",
    "把素材发到 TikTok 或 Facebook，链接放视频文案或评论区置顶。",
    "每次平台结算后，你的链接带来的订单会记到你名下，在「我的收益」里查看。",
  ],
  tabTasks: "任务中心",
  tabPromotions: "我的推广",
  tabEarnings: "我的收益",
  promotionsTitle: "我的推广",
  promotionsSubtitle: "你有推广链接的每部剧、链接被点开的次数，以及你用来发布的账号。",
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
  noLinks: "你还没有推广链接，打开一部剧就会自动生成。",
  browseTasks: "去任务中心看看",
  drama: "短剧",
  channel: "渠道",
  clicks: "点击",
  claimedOn: "生成时间",
  partialValue: (value: string) => `${value}（部分）`,
  partialNote: "部分：平台只给了其中一些天的这一项，合计只算了给了的那些天。",
  searchClips: "按剧名或素材名搜索",
  searchLabel: "搜索",
  theaterField: "剧场",
  genreField: "题材",
  tagField: "标签",
  tagPlaceholder: "输入或选择标签",
  tagNoMatch: "没有匹配的标签",
  audience: { female: "女频", male: "男频" },
  clipType: {
    recap: "解说",
    mixcut: "混剪",
    highlight: "高光",
    trailer: "预告",
    episode: "整集",
  },
  hotThisWeek: "本周爆款",
  hotNote: "最近 7 天拿到推广链接人数最多的 3 部剧之一。",
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

/** 推广链接: opens the drama's page on our site, /watch/<id>. */
export function promoLink(origin: string, code: string): string {
  return `${origin}/t/${code}`;
}

/** 资源推广链接: the same code, straight to the drama on its platform (or its page on our site until it has a platform link). */
export function resourceLink(origin: string, code: string): string {
  return `${origin}/t/${code}/go`;
}
