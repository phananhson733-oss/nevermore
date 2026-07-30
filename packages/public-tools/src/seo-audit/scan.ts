import {
  fetchPublicResource,
  isPathAllowed,
  parsePage,
  parseRobots,
  type PublicResourceFetchOptions,
  type PublicResourceResult,
} from "@sf/sources";
import type {
  SeoAuditPageProbe,
  SeoAuditProbe,
  SeoAuditResourceProbe,
} from "./types.ts";

const PAGE_TIMEOUT_MS = 8_000;
const RESOURCE_TIMEOUT_MS = 5_000;
const PAGE_BODY_CAP_BYTES = 1_500_000;
const RESOURCE_BODY_CAP_BYTES = 256_000;

export type SeoAuditScanErrorCode = "blocked" | "scan_failed" | "timeout";

export class SeoAuditScanError extends Error {
  readonly code: SeoAuditScanErrorCode;

  constructor(code: SeoAuditScanErrorCode) {
    super(code);
    this.name = "SeoAuditScanError";
    this.code = code;
  }
}

export type SeoAuditFetchResource = (
  url: string,
  options: PublicResourceFetchOptions,
) => Promise<PublicResourceResult>;

export interface SeoAuditScanOptions {
  readonly now?: () => Date;
}

function attr(tag: string | undefined, name: string): string | null {
  if (!tag) return null;
  const matched = tag.match(
    new RegExp(
      `\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
      "i",
    ),
  );
  return matched?.[1] ?? matched?.[2] ?? matched?.[3] ?? null;
}

function htmlLang(html: string): string | null {
  const tag = html.match(/<html\b[^>]*>/i)?.[0];
  return attr(tag, "lang")?.trim() || null;
}

function headingOutline(html: string): readonly string[] {
  return [...html.matchAll(/<h([1-6])\b[^>]*>/gi)]
    .slice(0, 100)
    .map((match) => `h${match[1]}`);
}

function socialTagsPresent(html: string): number {
  const required = new Set([
    "property:og:title",
    "property:og:description",
    "property:og:image",
    "name:twitter:card",
  ]);
  const found = new Set<string>();
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const property = attr(tag, "property")?.toLowerCase();
    const name = attr(tag, "name")?.toLowerCase();
    const content = attr(tag, "content");
    if (!content?.trim()) continue;
    if (property && required.has(`property:${property}`)) {
      found.add(`property:${property}`);
    }
    if (name && required.has(`name:${name}`)) {
      found.add(`name:${name}`);
    }
  }
  return found.size;
}

function jsonLdBlockCount(html: string): number {
  return [
    ...html.matchAll(
      /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>/gi,
    ),
  ].slice(0, 100).length;
}

function jsonLdErrorCount(html: string): number {
  let errors = 0;
  for (const match of html.matchAll(
    /<script\b[^>]*\btype\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script\s*>/gi,
  )) {
    try {
      JSON.parse(match[1] ?? "");
    } catch {
      errors += 1;
    }
  }
  return errors;
}

function structuralHtml(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(
      /<\s*(script|style|noscript|template|svg|canvas|iframe)\b[^>]*>[\s\S]*?<\/\s*\1\s*>/gi,
      " ",
    );
}

function isHtmlContentType(contentType: string | null): boolean {
  if (contentType === null) return true;
  return /^\s*(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType);
}

function xRobotsNoindex(value: string | null): boolean {
  if (!value) return false;
  return value
    .split(",")
    .map((directive) => directive.trim().toLowerCase())
    .some(
      (directive) =>
        directive === "noindex" ||
        directive === "none" ||
        directive.endsWith(": noindex") ||
        directive.endsWith(": none"),
    );
}

function pageProbe(
  result: Extract<PublicResourceResult, { kind: "ok" }>,
): SeoAuditPageProbe {
  const htmlAvailable = isHtmlContentType(result.contentType);
  const structure = htmlAvailable ? structuralHtml(result.body) : "";
  const parsed = htmlAvailable
    ? parsePage(structure, result.finalUrl)
    : null;
  const prefixNoindex =
    xRobotsNoindex(result.xRobotsTag) ||
    (parsed ? !parsed.robotsIndexable : false);

  return {
    requestedUrl: result.requestedUrl,
    finalUrl: result.finalUrl,
    firstStatus: result.firstStatus,
    statusCode: result.finalStatus,
    redirectChain: result.redirectChain,
    contentType: result.contentType,
    bodyComplete: result.bodyComplete,
    robotsNoindex: prefixNoindex
      ? true
      : result.bodyComplete && htmlAvailable
        ? false
        : null,
    title: parsed?.title ?? null,
    metaDescription: parsed?.metaDescription ?? null,
    canonical: parsed?.canonicalTarget ?? null,
    htmlLang: htmlAvailable ? htmlLang(structure) : null,
    h1Count: parsed?.h1.length ?? 0,
    headingOutline: htmlAvailable ? headingOutline(structure) : [],
    wordCount: parsed?.wordCount ?? 0,
    internalLinkCount: parsed?.internalOutlinks.length ?? 0,
    socialMetaTagsPresent: htmlAvailable
      ? socialTagsPresent(structure)
      : 0,
    jsonLdBlockCount: htmlAvailable ? jsonLdBlockCount(result.body) : 0,
    jsonLdErrorCount: htmlAvailable ? jsonLdErrorCount(result.body) : 0,
  };
}

type ResourceKind = "robots" | "sitemap";

function failedResource(url: string): SeoAuditResourceProbe {
  return {
    url,
    state: "fetch_error",
    statusCode: 0,
    bodyComplete: false,
  };
}

function resourceProbe(
  url: string,
  kind: ResourceKind,
  result: PublicResourceResult,
): SeoAuditResourceProbe {
  if (result.kind === "error") return failedResource(url);
  const statusCode = result.finalStatus;
  if (
    statusCode === 404 ||
    (kind === "robots" && statusCode === 410)
  ) {
    return {
      url,
      state: kind === "robots" ? "absent" : "missing",
      statusCode,
      bodyComplete: result.bodyComplete,
    };
  }
  if (statusCode !== 200) {
    return {
      url,
      state: "server_error",
      statusCode,
      bodyComplete: result.bodyComplete,
    };
  }
  if (!result.bodyComplete) {
    return {
      url,
      state: "too_large",
      statusCode,
      bodyComplete: false,
    };
  }
  const body = result.body.trim();
  if (!body) {
    return {
      url,
      state: "empty",
      statusCode,
      bodyComplete: true,
    };
  }
  const valid =
    kind === "robots"
      ? /^\s*user-agent\s*:/im.test(body)
      : /<(?:\w+:)?(?:urlset|sitemapindex)\b/i.test(body);
  return {
    url,
    state: valid ? "parsed" : "malformed",
    statusCode,
    bodyComplete: true,
  };
}

function robotsPageAllowed(
  result: PublicResourceResult,
  pageFinalUrl: string,
): boolean | null {
  if (result.kind === "error") return null;
  if (result.finalStatus === 404 || result.finalStatus === 410) return true;
  if (
    result.finalStatus !== 200 ||
    !result.bodyComplete ||
    !/^\s*user-agent\s*:/im.test(result.body)
  ) {
    return null;
  }
  const page = new URL(pageFinalUrl);
  const { groups } = parseRobots(result.body, page.origin, true);
  return isPathAllowed(groups, "Googlebot", `${page.pathname}${page.search}`);
}

function pageFailureCode(
  result: Extract<PublicResourceResult, { kind: "error" }>,
): SeoAuditScanErrorCode {
  if (result.code === "timeout") return "timeout";
  if (result.code === "blocked" || result.code === "cross_origin") {
    return "blocked";
  }
  return "scan_failed";
}

export async function scanSeoAuditSite(
  url: string,
  options: SeoAuditScanOptions = {},
  fetchResource: SeoAuditFetchResource = fetchPublicResource,
): Promise<SeoAuditProbe> {
  const homepage = await fetchResource(url, {
    timeoutMs: PAGE_TIMEOUT_MS,
    maxRedirects: 5,
    maxBodyBytes: PAGE_BODY_CAP_BYTES,
  });
  if (homepage.kind === "error") {
    throw new SeoAuditScanError(pageFailureCode(homepage));
  }

  const page = pageProbe(homepage);
  const origin = new URL(page.finalUrl).origin;
  const robotsUrl = new URL("/robots.txt", origin).toString();
  const sitemapUrl = new URL("/sitemap.xml", origin).toString();
  const resourceOptions: PublicResourceFetchOptions = {
    timeoutMs: RESOURCE_TIMEOUT_MS,
    maxRedirects: 5,
    maxBodyBytes: RESOURCE_BODY_CAP_BYTES,
    allowedOrigin: origin,
  };
  const [robotsResult, sitemapResult] = await Promise.all([
    fetchResource(robotsUrl, resourceOptions),
    fetchResource(sitemapUrl, resourceOptions),
  ]);

  return {
    requestedUrl: url,
    scannedAt: (options.now ?? (() => new Date()))().toISOString(),
    page,
    robots: resourceProbe(robotsUrl, "robots", robotsResult),
    robotsPageAllowed: robotsPageAllowed(robotsResult, page.finalUrl),
    sitemap: resourceProbe(sitemapUrl, "sitemap", sitemapResult),
  };
}
