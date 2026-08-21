// @input  -- one full same-origin URL/path plus target-language and depth bounds
// @output -- an explicit L2 eligibility result, route kind, or exclusion reason
// @pos    -- the hard contract before page-value ordering and any page request

import {
  pageValueBreakdown,
  pageValueIsContextCandidate,
  type PageValueBreakdown,
} from "./page-value.ts";

export const CONTEXT_PROFILE_CANDIDATE_EXCLUSION_REASONS = [
  "company_utility",
  "legal_policy",
  "account_auth",
  "content_detail",
  "pagination",
  "foreign_locale",
  "depth_limit",
  "non_context_section",
] as const;

export type ContextProfileCandidateExclusionReason =
  (typeof CONTEXT_PROFILE_CANDIDATE_EXCLUSION_REASONS)[number];

export type ContextProfileCandidateKind =
  | "product"
  | "pricing"
  | "content_list"
  | "fallback";

export interface ContextProfileCandidateOptions {
  readonly targetLanguage: string;
  readonly maxDepth: number;
}

export type ContextProfileCandidateClassification =
  | {
      readonly eligible: true;
      readonly kind: ContextProfileCandidateKind;
      readonly value: PageValueBreakdown;
    }
  | {
      readonly eligible: false;
      readonly reason: ContextProfileCandidateExclusionReason;
      readonly value: PageValueBreakdown;
    };

const COMPANY_UTILITY_SEGMENTS = new Set([
  "about",
  "about-us",
  "ueber-uns",
  "über-uns",
  "unternehmen",
  "contact",
  "contact-us",
  "kontakt",
  "careers",
  "career",
  "jobs",
  "job",
  "karriere",
  "stellenangebote",
]);

const LEGAL_POLICY_SEGMENTS = new Set([
  "privacy",
  "privacy-policy",
  "datenschutz",
  "terms",
  "terms-of-service",
  "terms-and-conditions",
  "legal",
  "legal-notice",
  "impressum",
  "rechtliches",
  "agb",
  "nutzungsbedingungen",
]);

const ACCOUNT_AUTH_SEGMENTS = new Set([
  "login",
  "log-in",
  "signin",
  "sign-in",
  "signup",
  "sign-up",
  "register",
  "registration",
  "account",
  "my-account",
  "user-account",
  "dashboard",
  "customer-dashboard",
  "admin",
  "wp-admin",
  "auth",
]);

/**
 * Containers under which a later utility/auth segment still names site
 * furniture. Restricting the deeper match to these avoids treating
 * `/solutions/legal` or `/product/account` as policy/login pages.
 */
const UTILITY_CONTAINER_SEGMENTS = new Set([
  "company",
  "corporate",
  "portal",
  "customer",
  "customers",
  "user",
  "users",
  "member",
  "members",
]);

const CONTENT_LIST_SEGMENTS = new Set([
  "blog",
  "blogs",
  "resource",
  "resources",
  "article",
  "articles",
  "post",
  "posts",
  "insights",
  "guides",
  "library",
]);

const PAGE_QUERY_KEYS = new Set([
  "page",
  "paged",
  "pageno",
  "page_number",
  "page-number",
]);
const OFFSET_QUERY_KEYS = new Set(["offset", "start"]);

function parsedUrl(urlOrPath: string): URL {
  return new URL(urlOrPath, "https://context.invalid");
}

function positiveInteger(value: string): number | null {
  if (!/^\d+$/u.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function isPagination(url: URL, segments: readonly string[]): boolean {
  for (const [rawKey, rawValue] of url.searchParams.entries()) {
    const key = rawKey.toLowerCase();
    const value = positiveInteger(rawValue.trim());
    if (value === null) continue;
    if (PAGE_QUERY_KEYS.has(key) && value >= 2) return true;
    if (OFFSET_QUERY_KEYS.has(key) && value > 0) return true;
  }
  return segments.some((segment, index) => {
    if (segment !== "page" && segment !== "paged") return false;
    const value = positiveInteger(segments[index + 1] ?? "");
    return value !== null && value >= 2;
  });
}

function excluded(
  reason: ContextProfileCandidateExclusionReason,
  value: PageValueBreakdown,
): ContextProfileCandidateClassification {
  return { eligible: false, reason, value };
}

function matchesRouteFamily(
  segments: readonly string[],
  family: ReadonlySet<string>,
): boolean {
  const first = segments[0] ?? "";
  return (
    family.has(first) ||
    (UTILITY_CONTAINER_SEGMENTS.has(first) &&
      segments.slice(1).some((segment) => family.has(segment)))
  );
}

export function classifyContextProfileCandidate(
  urlOrPath: string,
  options: ContextProfileCandidateOptions,
): ContextProfileCandidateClassification {
  const url = parsedUrl(urlOrPath);
  const value = pageValueBreakdown(url.pathname, options);
  const first = value.segments[0] ?? "";

  if (isPagination(url, value.segments)) return excluded("pagination", value);
  if (matchesRouteFamily(value.segments, COMPANY_UTILITY_SEGMENTS)) {
    return excluded("company_utility", value);
  }
  if (matchesRouteFamily(value.segments, LEGAL_POLICY_SEGMENTS)) {
    return excluded("legal_policy", value);
  }
  if (matchesRouteFamily(value.segments, ACCOUNT_AUTH_SEGMENTS)) {
    return excluded("account_auth", value);
  }
  if (CONTENT_LIST_SEGMENTS.has(first) && value.depth > 1) {
    return excluded("content_detail", value);
  }
  if (value.foreignLocalePenalty < 0) return excluded("foreign_locale", value);
  if (value.depth > options.maxDepth) return excluded("depth_limit", value);
  if (CONTENT_LIST_SEGMENTS.has(first) && value.depth === 1) {
    return { eligible: true, kind: "content_list", value };
  }
  if (!pageValueIsContextCandidate(value)) {
    return excluded("non_context_section", value);
  }
  if (value.sectionScore === 9) {
    return { eligible: true, kind: "pricing", value };
  }
  if (value.sectionScore > 0) {
    return { eligible: true, kind: "product", value };
  }
  return { eligible: true, kind: "fallback", value };
}
