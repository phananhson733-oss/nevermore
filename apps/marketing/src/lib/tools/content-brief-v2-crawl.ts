// @input -- bounded competitor/owned targets, research language and shared run deadline
// @output -- shared lexical URL admission, ordered v2 evidence or an explicit failure per target
// @pos -- Marketing-only research acquisition via the shared SSRF-safe public transport

import { createHash } from "node:crypto";
import { isIP } from "node:net";
import {
  CRAWL_CONCURRENCY, CRAWL_DEADLINE_MS, CRAWL_FETCH_TIMEOUT_MS,
  CRAWL_MAX_BYTES_PER_PAGE, ENVELOPE_MS,
} from "@sf/public-tools/content-brief/constants";
import type { ResearchPage } from "@sf/public-tools/content-brief/v2-contract";
import { sameBriefV2OwnedPage } from "@sf/public-tools/content-brief/v2-generation";
import { fetchPublicResource, type PublicResourceResult } from "@sf/sources/public-http";

import { CRAWL_TEARDOWN_GRACE_MS } from "./content-brief-crawl.ts";
import { extractContentBriefResearch } from "./content-brief-research-extract.ts";

export interface ContentBriefV2CrawlTarget {
  readonly id: string;
  readonly role: "competitor" | "owned";
  readonly url: string;
}

export interface ContentBriefV2CrawlFailure {
  readonly id: string;
  readonly url: string;
  readonly reason: "timeout" | "provider_error" | "redirected" | "insufficient_evidence";
}

export interface ContentBriefV2CrawlResult {
  readonly observed: ResearchPage[];
  readonly failed: readonly ContentBriefV2CrawlFailure[];
}

export interface ContentBriefV2CrawlInput {
  readonly targets: readonly ContentBriefV2CrawlTarget[];
  readonly language: string;
  readonly deadlineAt: number;
}

export interface ContentBriefV2CrawlDependencies {
  readonly fetchResource?: typeof fetchPublicResource;
  readonly now?: () => number;
}

type Outcome =
  | { readonly kind: "observed"; readonly value: ResearchPage }
  | { readonly kind: "failed"; readonly value: ContentBriefV2CrawlFailure };

/** Lexical check only. The public transport owns DNS/IP safety on every hop. */
function publicUrl(raw: string): URL | null {
  if (raw.length > 2_048 || /[\\\s\p{Cc}]/u.test(raw)) return null;
  try {
    const url = new URL(raw);
    const hostname = url.hostname.replace(/^\[|\]$/gu, "");
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.port ||
        !hostname.includes(".") || isIP(hostname) !== 0 || hostname === "metadata.google.internal" ||
        hostname.endsWith(".localhost") || hostname.endsWith(".local") || url.href.length > 2_048) return null;
    url.hash = "";
    return url;
  } catch { return null; }
}

/** Pre-filter individual provider URLs without weakening strict batch validation. */
export function isContentBriefV2CrawlUrl(raw: string): boolean {
  return publicUrl(raw) !== null;
}

function acceptsRedirect(target: ContentBriefV2CrawlTarget, fromUrl: string, toUrl: string): boolean {
  const from = publicUrl(fromUrl);
  const to = publicUrl(toUrl);
  if (!from || !to || (from.protocol === "https:" && to.protocol !== "https:")) return false;
  return target.role === "competitor" || sameBriefV2OwnedPage(target.url, toUrl);
}

function validateTargets(input: ContentBriefV2CrawlInput): ContentBriefV2CrawlTarget[] {
  if (!Number.isFinite(input.deadlineAt) || input.targets.length > 13) throw new RangeError("invalid research crawl input");
  const ids = new Set<string>();
  const urls = new Set<string>();
  return input.targets.map((target) => {
    const idValid = target.role === "competitor" ? /^C(?:[1-9]|10)$/u.test(target.id)
      : target.role === "owned" && /^T[1-3]$/u.test(target.id);
    const url = publicUrl(target.url);
    if (!idValid || ids.has(target.id) || !url || urls.has(url.href)) throw new RangeError("invalid research crawl target");
    ids.add(target.id);
    urls.add(url.href);
    return { id: target.id, role: target.role, url: target.url };
  });
}

function failure(target: ContentBriefV2CrawlTarget, reason: ContentBriefV2CrawlFailure["reason"]): Outcome {
  return { kind: "failed", value: { id: target.id, url: target.url, reason } };
}

/** Drop late results and consume late rejections, including stuck dispatcher close. */
function boundedFetch(operation: () => Promise<PublicResourceResult>, limitMs: number): Promise<PublicResourceResult> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ kind: "error", code: "timeout" }), limitMs);
    void Promise.resolve().then(operation).then(
      (value) => { clearTimeout(timer); resolve(value); },
      () => { clearTimeout(timer); resolve({ kind: "error", code: "network" }); },
    );
  });
}

interface Clock {
  readonly now: () => number;
  readonly wallClockAt: number;
}

async function crawlOne(
  target: ContentBriefV2CrawlTarget, language: string, clock: Clock, fetchResource: typeof fetchPublicResource,
): Promise<Outcome> {
  const remaining = Math.floor(clock.wallClockAt - clock.now());
  if (remaining < 1) return failure(target, "timeout");
  const timeoutMs = Math.min(CRAWL_FETCH_TIMEOUT_MS, remaining);
  let replaced = false;
  const result = await boundedFetch(() => fetchResource(target.url, {
    timeoutMs, maxBodyBytes: CRAWL_MAX_BYTES_PER_PAGE,
    allowRedirect: (fromUrl, toUrl): boolean => {
      const allowed = acceptsRedirect(target, fromUrl, toUrl);
      if (!allowed && target.role === "owned") replaced = true;
      return allowed;
    },
  }), Math.min(remaining, timeoutMs + CRAWL_TEARDOWN_GRACE_MS));
  if (clock.now() >= clock.wallClockAt) return failure(target, "timeout");
  if (replaced) return failure(target, "redirected");
  if (result.kind === "error") return failure(target, result.code === "timeout" ? "timeout" : "provider_error");
  if (!publicUrl(result.finalUrl) || result.finalStatus < 200 || result.finalStatus > 299) return failure(target, "provider_error");
  let fromUrl = target.url;
  for (const toUrl of [...result.redirectChain, result.finalUrl]) {
    if (!acceptsRedirect(target, fromUrl, toUrl)) return failure(target, target.role === "owned" ? "redirected" : "provider_error");
    fromUrl = toUrl;
  }
  const mediaType = result.contentType?.split(";")[0]?.trim().toLowerCase();
  if (mediaType !== "text/html" && mediaType !== "application/xhtml+xml") return failure(target, "insufficient_evidence");
  try {
    const research = extractContentBriefResearch(result.body, language);
    const contentHash = createHash("sha256").update(result.body).digest("hex");
    const fetchedAt = clock.now();
    if (fetchedAt >= clock.wallClockAt) return failure(target, "timeout");
    if (research.segments.length === 0) return failure(target, "insufficient_evidence");
    return { kind: "observed", value: {
      ...target, final_url: result.finalUrl, fetched_at: new Date(fetchedAt).toISOString(),
      content_hash: contentHash, body_complete: result.bodyComplete, research,
    } };
  } catch { return failure(target, "insufficient_evidence"); }
}

/** One bounded fetch per target; every target has one result in its input order. */
export async function crawlContentBriefV2Targets(
  input: ContentBriefV2CrawlInput,
  dependencies: ContentBriefV2CrawlDependencies = {},
): Promise<ContentBriefV2CrawlResult> {
  const targets = validateTargets(input);
  const now = dependencies.now ?? Date.now;
  const clock = { now, wallClockAt: Math.min(now() + CRAWL_DEADLINE_MS, input.deadlineAt - ENVELOPE_MS) };
  const outcomes: Outcome[] = new Array<Outcome>(targets.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = next++;
      const target = targets[index];
      if (!target) return;
      outcomes[index] = await crawlOne(target, input.language, clock, dependencies.fetchResource ?? fetchPublicResource);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CRAWL_CONCURRENCY, targets.length) }, () => worker()));
  return {
    observed: outcomes.flatMap((item) => item.kind === "observed" ? [item.value] : []),
    failed: outcomes.flatMap((item) => item.kind === "failed" ? [item.value] : []),
  };
}
