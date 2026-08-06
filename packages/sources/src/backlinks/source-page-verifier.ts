import { canonicalizeUrl } from "../canonical-url.ts";
import {
  CRAWL_PROJECTION_LIMITS,
  boundChars,
} from "../crawl/types.ts";
import {
  fetchPublicResource as defaultFetchPublicResource,
  type PublicResourceFetchOptions,
  type PublicResourceResult,
} from "../public-http/index.ts";

export const BACKLINK_SOURCE_PAGE_VERIFY_TIMEOUT_MS = 8_000;
export const BACKLINK_SOURCE_PAGE_VERIFY_MAX_REDIRECTS = 3;
export const BACKLINK_SOURCE_PAGE_VERIFY_MAX_BODY_BYTES = 512 * 1024;
export const BACKLINK_SOURCE_PAGE_VERIFY_USER_AGENT =
  "GenGrowth-Backlink-Verifier/1.0 (+https://gengrowth.ai)";

export type BacklinkSourcePageVerificationStatus =
  | "verified"
  | "absent"
  | "blocked"
  | "inconclusive";

export interface VerifyBacklinkSourcePageInput {
  readonly sourceUrl: string;
  readonly targetUrl: string;
}

export type BacklinkPublicResourceFetch = (
  url: string,
  options: PublicResourceFetchOptions,
) => Promise<PublicResourceResult>;

export interface VerifyBacklinkSourcePageOptions {
  /** Offline test seam. Production uses the guarded, IP-pinned transport. */
  readonly fetchPublicResource?: BacklinkPublicResourceFetch;
  readonly now?: () => Date;
}

export interface BacklinkSourcePageVerification {
  readonly status: BacklinkSourcePageVerificationStatus;
  readonly checkedAt: string;
  readonly finalUrl: string | null;
  readonly httpStatus: number | null;
  readonly anchorText: string | null;
  readonly rel: string | null;
  readonly limitation: string | null;
}

interface MatchedLink {
  readonly anchorText: string | null;
  readonly rel: string | null;
}

const HTML_MEDIA_TYPES = new Set(["text/html", "application/xhtml+xml"]);

function verification(
  status: BacklinkSourcePageVerificationStatus,
  checkedAt: string,
  overrides: Partial<BacklinkSourcePageVerification> = {},
): BacklinkSourcePageVerification {
  return {
    status,
    checkedAt,
    finalUrl: null,
    httpStatus: null,
    anchorText: null,
    rel: null,
    limitation: null,
    ...overrides,
  };
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&#(?:x([0-9a-f]+)|(\d+));/gi, (_match, hex, decimal) => {
      const codePoint = Number.parseInt(hex ?? decimal, hex ? 16 : 10);
      const validScalar =
        Number.isSafeInteger(codePoint) &&
        codePoint > 0 &&
        codePoint <= 0x10ffff &&
        (codePoint < 0xd800 || codePoint > 0xdfff);
      return validScalar ? String.fromCodePoint(codePoint) : "\ufffd";
    });
}

function attribute(attributes: string, name: string): string | null {
  const match = attributes.match(
    new RegExp(
      `(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      "i",
    ),
  );
  const value = match?.[1] ?? match?.[2] ?? match?.[3];
  return value === undefined ? null : decodeHtml(value);
}

function normalizedText(value: string): string | null {
  const text = decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text
    ? boundChars(text, CRAWL_PROJECTION_LIMITS.maxAnchorTextChars)
    : null;
}

function anchorText(attributes: string, content: string): string | null {
  const ariaLabel = attribute(attributes, "aria-label");
  if (ariaLabel) return normalizedText(ariaLabel);

  const visible = normalizedText(content);
  if (visible) return visible;

  for (const image of content.matchAll(/<img\b([^>]*)>/gi)) {
    const alt = attribute(image[1] ?? "", "alt");
    if (alt) return normalizedText(alt);
  }
  return null;
}

function normalizedRel(attributes: string): string | null {
  const rel = attribute(attributes, "rel")?.replace(/\s+/g, " ").trim();
  return rel ? boundChars(rel, CRAWL_PROJECTION_LIMITS.maxRelChars) : null;
}

function findTargetLink(
  html: string,
  sourcePageUrl: string,
  targetSubjectUrl: string,
): MatchedLink | null {
  for (const match of html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const attributes = match[1] ?? "";
    const href = attribute(attributes, "href");
    if (!href) continue;

    const candidate = canonicalizeUrl(href, sourcePageUrl);
    if (!candidate) continue;
    if (candidate.subjectUrl !== targetSubjectUrl) continue;

    return {
      anchorText: anchorText(attributes, match[2] ?? ""),
      rel: normalizedRel(attributes),
    };
  }
  return null;
}

function sourceOrigin(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function mediaType(contentType: string | null): string | null {
  return contentType?.split(";", 1)[0]?.trim().toLowerCase() || null;
}

/**
 * Selectively verifies one provider-discovered backlink source page. Only a
 * complete 2xx HTML response may prove absence; partial evidence may prove a
 * link exists, but never that it does not.
 */
export async function verifyBacklinkSourcePage(
  input: VerifyBacklinkSourcePageInput,
  options: VerifyBacklinkSourcePageOptions = {},
): Promise<BacklinkSourcePageVerification> {
  const checkedAt = (options.now?.() ?? new Date()).toISOString();
  const allowedOrigin = sourceOrigin(input.sourceUrl);
  if (!allowedOrigin) {
    return verification("blocked", checkedAt, {
      limitation: "invalid_source_url",
    });
  }

  const target = canonicalizeUrl(input.targetUrl);
  if (!target) {
    return verification("inconclusive", checkedAt, {
      limitation: "invalid_target_url",
    });
  }
  const resourceFetch =
    options.fetchPublicResource ?? defaultFetchPublicResource;

  let resource: PublicResourceResult;
  try {
    resource = await resourceFetch(input.sourceUrl, {
      allowedOrigin,
      timeoutMs: BACKLINK_SOURCE_PAGE_VERIFY_TIMEOUT_MS,
      maxRedirects: BACKLINK_SOURCE_PAGE_VERIFY_MAX_REDIRECTS,
      maxBodyBytes: BACKLINK_SOURCE_PAGE_VERIFY_MAX_BODY_BYTES,
      userAgent: BACKLINK_SOURCE_PAGE_VERIFY_USER_AGENT,
    });
  } catch {
    return verification("inconclusive", checkedAt, {
      limitation: "fetch_network",
    });
  }

  if (resource.kind === "error") {
    const status =
      resource.code === "blocked" ||
      resource.code === "cross_origin" ||
      resource.code === "invalid_redirect"
        ? "blocked"
        : "inconclusive";
    return verification(status, checkedAt, {
      limitation: `fetch_${resource.code}`,
    });
  }

  const responseIdentity = {
    finalUrl: resource.finalUrl,
    httpStatus: resource.finalStatus,
  };
  if (resource.finalStatus < 200 || resource.finalStatus >= 300) {
    return verification("inconclusive", checkedAt, {
      ...responseIdentity,
      limitation: `http_status_not_2xx:${resource.finalStatus}`,
    });
  }
  if (!HTML_MEDIA_TYPES.has(mediaType(resource.contentType) ?? "")) {
    return verification("inconclusive", checkedAt, {
      ...responseIdentity,
      limitation: "unsupported_html_content_type",
    });
  }

  const matched = findTargetLink(
    resource.body,
    resource.finalUrl,
    target.subjectUrl,
  );
  if (matched) {
    return verification("verified", checkedAt, {
      ...responseIdentity,
      anchorText: matched.anchorText,
      rel: matched.rel,
    });
  }
  if (!resource.bodyComplete) {
    return verification("inconclusive", checkedAt, {
      ...responseIdentity,
      limitation: "response_body_truncated",
    });
  }

  return verification("absent", checkedAt, responseIdentity);
}
