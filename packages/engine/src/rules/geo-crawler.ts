/**
 * GEO-CRAWLER-002 (spec §8.3, §8.4). Inspects the observed robots.txt for the AI
 * answer-engine crawlers (OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot)
 * and flags any whose applicable group disallows the whole site or a commercial
 * path. robots.txt is observed (grade B). A missing/un-fetched robots.txt is NOT
 * a block. PURE: reads only the frozen `DiagnosticContext` — no DB, network, LLM,
 * or clock.
 */

import { AI_BOT_USER_AGENTS } from "@sf/sources";
import type { CrawlRobotsProjection } from "@sf/sources";
import type { DiagnosticContext } from "../context.ts";
import type {
  DiagnosticRule,
  EvidenceDraft,
  FindingCandidate,
  RuleResult,
  Severity,
} from "../rule.ts";

type RobotsGroup = CrawlRobotsProjection["groups"][number];

/** Commercial path prefixes whose disallow blocks conversion-relevant crawling. */
const COMMERCIAL_PREFIXES = [
  "/pricing",
  "/product",
  "/service",
  "/solutions",
  "/features",
  "/demo",
  "/trial",
  "/signup",
  "/contact",
  "/shop",
  "/cart",
] as const;

const ROBOTS_LIMITATION =
  "robots.txt directives are observed as published; individual crawler behavior may differ.";

type BlockScope = "site" | "commercial_path";

interface BlockInfo {
  readonly scope: BlockScope;
  readonly rule: string;
}

/** The bot-specific group (case-insensitive) if present, else the `*` group. */
function groupForBot(
  groups: readonly RobotsGroup[],
  userAgent: string,
): RobotsGroup | null {
  const lower = userAgent.toLowerCase();
  return (
    groups.find((g) => g.userAgent.toLowerCase() === lower) ??
    groups.find((g) => g.userAgent === "*") ??
    null
  );
}

function isCommercialDisallow(entry: string): boolean {
  return COMMERCIAL_PREFIXES.some((prefix) => entry === prefix || entry.startsWith(prefix));
}

/** Whole-site disallow takes precedence over a commercial-path disallow. */
function blockInfo(group: RobotsGroup): BlockInfo | null {
  const entries = group.disallow.map((d) => d.trim()).filter((d) => d.length > 0);
  if (entries.some((entry) => entry === "/")) {
    return { scope: "site", rule: "/" };
  }
  const commercial = entries.find((entry) => isCommercialDisallow(entry));
  if (commercial !== undefined) {
    return { scope: "commercial_path", rule: commercial };
  }
  return null;
}

function candidateFor(
  ctx: DiagnosticContext,
  userAgent: string,
  info: BlockInfo,
): FindingCandidate {
  const subjectRef = `user_agent:${userAgent}`;
  const severity: Severity =
    info.scope === "site" || info.scope === "commercial_path" ? "high" : "medium";
  const claim =
    info.scope === "site"
      ? `robots.txt disallows the whole site ("Disallow: ${info.rule}") for ${userAgent}.`
      : `robots.txt disallows a commercial path ("Disallow: ${info.rule}") for ${userAgent}.`;
  const evidence: EvidenceDraft = {
    sourceProvider: "crawl",
    origin: "direct_public",
    method: "observed",
    grade: "B",
    availability: "available",
    support: "supports",
    subjectRefs: [subjectRef],
    claim,
    observedAt: ctx.observedAt("crawl"),
    limitation: ROBOTS_LIMITATION,
  };
  return {
    subjectRefs: [subjectRef],
    severity,
    titleArgs: { userAgent, rule: info.rule, scope: info.scope },
    metrics: { userAgent, scope: info.scope },
    evidence: [evidence],
  };
}

function evaluate(ctx: DiagnosticContext): RuleResult {
  if (!ctx.hasDataset("crawl")) {
    return { status: "skipped", reason: "missing_dataset" };
  }

  const robots = ctx.robots;
  if (robots === null || !robots.fetched) {
    return { status: "inconclusive", reason: "robots_unavailable" };
  }

  const candidates: FindingCandidate[] = [];
  for (const userAgent of AI_BOT_USER_AGENTS) {
    const group = groupForBot(robots.groups, userAgent);
    if (group === null) continue;
    const info = blockInfo(group);
    if (info === null) continue;
    candidates.push(candidateFor(ctx, userAgent, info));
  }

  if (candidates.length === 0) {
    return { status: "pass", metrics: { robotsFetched: 1, blockedBotCount: 0 } };
  }

  return { status: "candidate", candidates };
}

export const geoCrawlerRule = {
  id: "GEO-CRAWLER-002",
  version: 1,
  domain: "geo_ai",
  requiredDatasets: [{ dataset: "crawl", required: true }],
  evaluate,
} satisfies DiagnosticRule;
