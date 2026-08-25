// @input  -- an untrusted competitor-gap request body
// @output -- one bounded, canonical request or the public invalid-input code
// @pos    -- the only public request-shape and hostname normalization boundary

import type { CompetitorKeywordGapRequestV1 } from "./types.ts";

export const COMPETITOR_KEYWORD_GAP_MAX_COMPETITORS = 5;
/** Bounds the client-declared contract version, not a format check. */
const ACCEPT_SCHEMA_VERSION_MAX_LENGTH = 64;

export type ParsedCompetitorKeywordGapInput = CompetitorKeywordGapRequestV1;

export type CompetitorKeywordGapInputParseResult =
  | {
      readonly ok: true;
      readonly value: ParsedCompetitorKeywordGapInput;
    }
  | {
      readonly ok: false;
      readonly code: "invalid_input";
    };

const INVALID_INPUT = { ok: false, code: "invalid_input" } as const;
const DOMAIN_LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const TWO_LETTER_CODE = /^[A-Za-z]{2}$/;
const SEARCH_CONSOLE_DOMAIN_PREFIX = "sc-domain:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIpv4(hostname: string): boolean {
  const labels = hostname.split(".");
  return (
    labels.length === 4 &&
    labels.every(
      (label) =>
        /^\d{1,3}$/.test(label) && Number(label) >= 0 && Number(label) <= 255,
    )
  );
}

function isPublicHostname(hostname: string): boolean {
  if (hostname.length > 253 || hostname.includes(":") || isIpv4(hostname)) {
    return false;
  }

  const labels = hostname.split(".");
  return (
    labels.length >= 2 &&
    labels.every((label) => label.length <= 63 && DOMAIN_LABEL.test(label))
  );
}

function isSearchConsoleDomainProperty(property: string): boolean {
  if (!property.startsWith(SEARCH_CONSOLE_DOMAIN_PREFIX)) return false;
  const hostname = property.slice(SEARCH_CONSOLE_DOMAIN_PREFIX.length);
  return (
    hostname === hostname.toLowerCase() &&
    !hostname.endsWith(".") &&
    !/[/\\?#@:\s]/.test(hostname) &&
    isPublicHostname(hostname)
  );
}

function isSearchConsoleUrlPrefixProperty(property: string): boolean {
  if (!/^https?:\/\//i.test(property) || /[\s\\?#]/.test(property)) {
    return false;
  }

  const authority = property
    .slice(property.indexOf("://") + 3)
    .split("/", 1)[0];
  if (authority === undefined || authority.includes("@")) return false;

  try {
    const url = new URL(property);
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === "" &&
      isPublicHostname(hostname)
    );
  } catch {
    return false;
  }
}

function isSearchConsoleProperty(property: string): boolean {
  return property.startsWith(SEARCH_CONSOLE_DOMAIN_PREFIX)
    ? isSearchConsoleDomainProperty(property)
    : isSearchConsoleUrlPrefixProperty(property);
}

/** Normalize only a bare hostname or an HTTP(S) root URL. */
export function normalizeCompetitorKeywordGapDomain(
  input: string,
): string | null {
  const candidate = input.trim();
  if (candidate === "" || /[\s\\?#]/.test(candidate)) return null;

  const hasHttpScheme = /^https?:\/\//i.test(candidate);
  if (!hasHttpScheme && /[/\\?#@:]/.test(candidate)) return null;
  if (hasHttpScheme) {
    const authority = candidate
      .slice(candidate.indexOf("://") + 3)
      .split("/", 1)[0];
    // URL normalization erases explicit default ports (`:443`, `:80`), so
    // reject authority syntax before parsing rather than trusting `url.port`.
    if (
      authority === undefined ||
      authority.includes("@") ||
      authority.includes(":")
    ) {
      return null;
    }
  }

  let url: URL;
  try {
    url = new URL(hasHttpScheme ? candidate : `https://${candidate}`);
  } catch {
    return null;
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== "" ||
    url.port !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    return null;
  }

  let hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  if (hostname.startsWith("www.")) hostname = hostname.slice(4);

  return isPublicHostname(hostname) ? hostname : null;
}

export function parseCompetitorKeywordGapInput(
  input: unknown,
): CompetitorKeywordGapInputParseResult {
  if (!isRecord(input)) return INVALID_INPUT;

  const property = input["property"];
  const siteDomain = input["siteDomain"];
  const competitorDomains = input["competitorDomains"];
  const marketCode = input["marketCode"];
  const languageCode = input["languageCode"];
  const acceptSchemaVersion = input["acceptSchemaVersion"];

  if (
    typeof siteDomain !== "string" ||
    !Array.isArray(competitorDomains) ||
    competitorDomains.length < 1 ||
    competitorDomains.length > COMPETITOR_KEYWORD_GAP_MAX_COMPETITORS ||
    typeof marketCode !== "string" ||
    typeof languageCode !== "string" ||
    (property !== undefined &&
      (typeof property !== "string" || property.trim() === "")) ||
    typeof acceptSchemaVersion !== "string" ||
    acceptSchemaVersion === "" ||
    acceptSchemaVersion.length > ACCEPT_SCHEMA_VERSION_MAX_LENGTH
  ) {
    return INVALID_INPUT;
  }

  const trimmedMarketCode = marketCode.trim();
  const trimmedLanguageCode = languageCode.trim();
  const trimmedProperty = property?.trim();
  if (
    !TWO_LETTER_CODE.test(trimmedMarketCode) ||
    !TWO_LETTER_CODE.test(trimmedLanguageCode) ||
    (trimmedProperty !== undefined && !isSearchConsoleProperty(trimmedProperty))
  ) {
    return INVALID_INPUT;
  }

  const normalizedSite = normalizeCompetitorKeywordGapDomain(siteDomain);
  if (normalizedSite === null) return INVALID_INPUT;

  const normalizedCompetitors: string[] = [];
  const seen = new Set<string>();
  for (const value of competitorDomains) {
    if (typeof value !== "string") return INVALID_INPUT;
    const normalized = normalizeCompetitorKeywordGapDomain(value);
    if (
      normalized === null ||
      normalized === normalizedSite ||
      seen.has(normalized)
    ) {
      return INVALID_INPUT;
    }
    seen.add(normalized);
    normalizedCompetitors.push(normalized);
  }

  const common = {
    siteDomain: normalizedSite,
    competitorDomains: normalizedCompetitors,
    marketCode: trimmedMarketCode.toUpperCase(),
    languageCode: trimmedLanguageCode.toLowerCase(),
    acceptSchemaVersion,
  };

  return {
    ok: true,
    value:
      trimmedProperty === undefined
        ? common
        : { property: trimmedProperty, ...common },
  };
}
