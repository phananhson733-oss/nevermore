/**
 * Link-building targets (jsx:535-558). The pool keeps the prototype's sites; a
 * channel that is not one site has domain "" (the prototype wrote "—") and a
 * null DR, so its difficulty is null too: there is no site to rate, and
 * unavailable is null, never an invented number. The other DR values are
 * sample numbers. Action and asset copy is a plain instruction and says
 * nothing about what a listing brings. Types and levels are ids.
 */
import type { Level, LinkTarget, LinkType, Profile } from "../types.ts";
import { pick, rngOf, seedKey } from "./rng.ts";
import { normQ } from "./text.ts";

type PoolEntry = readonly [site: string, domain: string, dr: number | null];

export const LINK_POOL: Readonly<Record<LinkType, readonly PoolEntry[]>> = {
  dir: [
    ["Product Hunt", "producthunt.com", 91],
    ["AlternativeTo", "alternativeto.net", 87],
    ["SaaSHub", "saashub.com", 72],
    ["There's An AI For That", "theresanaiforthat.com", 78],
  ],
  agg: [
    ["G2", "g2.com", 92],
    ["Capterra", "capterra.com", 91],
    ["Slant", "slant.co", 74],
    ["Tool Finder", "toolfinder.co", 61],
  ],
  comm: [
    ["Reddit r/SEO", "reddit.com", 95],
    ["Indie Hackers", "indiehackers.com", 82],
    ["Hacker News", "news.ycombinator.com", 92],
    ["Lobsters", "lobste.rs", 70],
  ],
  rev: [
    ["TrustRadius", "trustradius.com", 84],
    ["Software Advice", "softwareadvice.com", 85],
    ["GetApp", "getapp.com", 84],
  ],
  media: [
    ["Growth newsletter（垂直）", "", null],
    ["行业播客", "", null],
    ["Substack 专栏", "substack.com", 90],
  ],
  swap: [
    ["同规模 SaaS 联名文章", "", null],
    ["工具互推目录", "", null],
  ],
};

export const DEFAULT_LINK_TYPES: readonly LinkType[] = ["dir", "agg", "comm"];

const HIGH_DR_ABOVE = 88;
const MID_DR_ABOVE = 75;

/** Difficulty from DR: above 88 high, above 75 mid, otherwise low. */
export function levelForDr(dr: number): Level {
  if (dr > HIGH_DR_ABOVE) return "high";
  if (dr > MID_DR_ABOVE) return "mid";
  return "low";
}

/** The prototype drew relevance from [高, 中, 高, 中]. */
const RELEVANCE_DRAWS: readonly Level[] = ["high", "mid", "high", "mid"];

const SUBMIT = "按对方公开的提交流程提交产品信息";
const PRODUCT_ASSET = "产品页 + 截图";

const ACTION: Readonly<Record<LinkType, string>> = {
  dir: SUBMIT,
  agg: SUBMIT,
  comm: "先按社区规则参与相关讨论，内容确实有帮助时再提及产品",
  rev: SUBMIT,
  media: "准备好可公开引用的资料后联系编辑投稿",
  swap: "先确认对方受众与产品相关，再商量合作方式",
};

const ASSET: Readonly<Record<LinkType, string>> = {
  dir: PRODUCT_ASSET,
  agg: "产品页 + 对比页",
  comm: PRODUCT_ASSET,
  rev: PRODUCT_ASSET,
  media: "可公开引用的原创数据（需自行准备并核对）",
  swap: PRODUCT_ASSET,
};

/** Every pool entry of each requested type, in the order the types are given; a repeated type is emitted once. */
export function mockLinks(
  profile: Pick<Profile, "brand">,
  types: readonly LinkType[],
): readonly LinkTarget[] {
  const brandKey = normQ(profile.brand);
  const uniqueTypes = types.filter(
    (type, index) => types.indexOf(type) === index,
  );
  return uniqueTypes.flatMap((type) =>
    LINK_POOL[type].map(([site, domain, dr]) => ({
      type,
      site,
      domain,
      dr,
      relevance: pick(RELEVANCE_DRAWS, rngOf(seedKey("link", site, brandKey))),
      difficulty: dr === null ? null : levelForDr(dr),
      action: ACTION[type],
      asset: ASSET[type],
    })),
  );
}
