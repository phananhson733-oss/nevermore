import {
  fetchPublicResource,
  type PublicResourceFetchOptions,
  type PublicResourceResult,
} from "@sf/sources/public-http";
import { isPathAllowed, parsePage, parseRobots } from "@sf/sources";
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
      `(?:^|[\\t\\n\\f\\r /])${name}[\\t\\n\\f\\r ]*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
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

function metaTags(html: string): readonly string[] {
  return [...html.matchAll(/<meta\b[^>]*>/gi)].map((match) => match[0]);
}

function hasConfiguredViewport(html: string): boolean {
  return metaTags(html).some((tag) => {
    if (attr(tag, "name")?.trim().toLowerCase() !== "viewport") return false;
    const content = attr(tag, "content")?.toLowerCase() ?? "";
    return (
      /(?:^|,)\s*width\s*=\s*device-width\s*(?:,|$)/.test(content) &&
      /(?:^|,)\s*initial-scale\s*=\s*1(?:\.0+)?\s*(?:,|$)/.test(content)
    );
  });
}

function hasMetaRefresh(html: string): boolean {
  return metaTags(html).some((tag) => {
    if (attr(tag, "http-equiv")?.trim().toLowerCase() !== "refresh") {
      return false;
    }
    return Boolean(attr(tag, "content")?.trim());
  });
}

function countSecurityHeaders(
  headers: Extract<PublicResourceResult, { kind: "ok" }>["securityHeaders"],
): number {
  return Object.values(headers).filter(Boolean).length;
}

function tagEnd(html: string, start: number): number {
  const namedTag = html
    .slice(start)
    .match(/^<\/?([a-z][a-z0-9:-]*)(?=[\t\n\f\r />])/i);
  if (namedTag) {
    const end = tagWithAttributesEnd(html, start + namedTag[0].length);
    return end < 0 ? -1 : end - 1;
  }
  let quote: '"' | "'" | null = null;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (quote) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === ">") return index;
  }
  return -1;
}

type EndTagState =
  | "before_attribute_name"
  | "attribute_name"
  | "after_attribute_name"
  | "before_attribute_value"
  | "double_quoted_value"
  | "single_quoted_value"
  | "unquoted_value"
  | "after_quoted_value"
  | "self_closing";

function tagWithAttributesEnd(html: string, afterName: number): number {
  let state: EndTagState = "before_attribute_name";
  for (let index = afterName; index < html.length; index += 1) {
    const character = html[index];
    const whitespace = /[\t\n\f\r ]/.test(character ?? "");
    if (state === "double_quoted_value") {
      if (character === '"') state = "after_quoted_value";
      continue;
    }
    if (state === "single_quoted_value") {
      if (character === "'") state = "after_quoted_value";
      continue;
    }
    if (state === "unquoted_value") {
      if (character === ">") return index + 1;
      if (whitespace) state = "before_attribute_name";
      continue;
    }
    if (state === "before_attribute_value") {
      if (whitespace) continue;
      if (character === '"') {
        state = "double_quoted_value";
      } else if (character === "'") {
        state = "single_quoted_value";
      } else if (character === ">") {
        return index + 1;
      } else {
        state = "unquoted_value";
      }
      continue;
    }
    if (state === "attribute_name") {
      if (character === ">") return index + 1;
      if (whitespace) {
        state = "after_attribute_name";
      } else if (character === "/") {
        state = "self_closing";
      } else if (character === "=") {
        state = "before_attribute_value";
      }
      continue;
    }
    if (state === "after_attribute_name") {
      if (character === ">") return index + 1;
      if (whitespace) continue;
      if (character === "/") {
        state = "self_closing";
      } else if (character === "=") {
        state = "before_attribute_value";
      } else {
        state = "attribute_name";
      }
      continue;
    }
    if (state === "after_quoted_value") {
      if (character === ">") return index + 1;
      if (whitespace) {
        state = "before_attribute_name";
      } else if (character === "/") {
        state = "self_closing";
      } else {
        state = "attribute_name";
      }
      continue;
    }
    if (state === "self_closing") {
      if (character === ">") return index + 1;
      state = "before_attribute_name";
      index -= 1;
      continue;
    }
    if (character === ">") return index + 1;
    if (whitespace) continue;
    if (character === "/") {
      state = "self_closing";
    } else {
      state = "attribute_name";
    }
  }
  return -1;
}

type OpeningTagResult =
  | {
      readonly kind: "complete";
      readonly name: string;
      readonly end: number;
      readonly source: string;
    }
  | { readonly kind: "incomplete_named_tag" }
  | { readonly kind: "not_a_named_tag" };

function openingTagAt(html: string, start: number): OpeningTagResult {
  const opening = html
    .slice(start)
    .match(/^<([a-z][a-z0-9:-]*)(?=[\t\n\f\r />])/i);
  if (!opening?.[1]) return { kind: "not_a_named_tag" };
  const exclusiveEnd = tagWithAttributesEnd(
    html,
    start + opening[0].length,
  );
  if (exclusiveEnd < 0) return { kind: "incomplete_named_tag" };
  return {
    kind: "complete",
    name: opening[1].toLowerCase(),
    end: exclusiveEnd - 1,
    source: html.slice(start, exclusiveEnd),
  };
}

function closingTagAt(
  html: string,
  name: string,
  start: number,
): { readonly start: number; readonly end: number } | null {
  const candidate = new RegExp(
    `<\\/${name}(?=[\\t\\n\\f\\r />])`,
    "gi",
  );
  candidate.lastIndex = start;
  const match = candidate.exec(html);
  if (!match) return null;
  const end = tagWithAttributesEnd(html, candidate.lastIndex);
  return end < 0 ? null : { start: match.index, end };
}

const JSON_LD_TEXT_ELEMENTS = new Set([
  "style",
  "textarea",
  "title",
  "xmp",
  "iframe",
  "noembed",
  "noframes",
  "plaintext",
  "noscript",
  "template",
  "svg",
  "canvas",
]);

function jsonLdEvidence(
  html: string,
): {
  readonly validBlocks: number;
  readonly malformedBlocks: number;
  readonly scanComplete: boolean;
} {
  let validBlocks = 0;
  let errors = 0;
  let inspected = 0;
  let cursor = 0;

  while (cursor < html.length) {
    const nextTag = html.indexOf("<", cursor);
    if (nextTag < 0) break;
    if (html.startsWith("<!--", nextTag)) {
      const commentEnd = html.indexOf("-->", nextTag + 4);
      if (commentEnd < 0) break;
      cursor = commentEnd + 3;
      continue;
    }
    const opening = openingTagAt(html, nextTag);
    if (opening.kind === "incomplete_named_tag") {
      return { validBlocks, malformedBlocks: errors, scanComplete: false };
    }
    if (opening.kind === "not_a_named_tag") {
      cursor = nextTag + 1;
      continue;
    }
    if (opening.name !== "script" && !JSON_LD_TEXT_ELEMENTS.has(opening.name)) {
      cursor = opening.end + 1;
      continue;
    }
    if (opening.name === "plaintext") break;
    const closing = closingTagAt(
      html,
      opening.name,
      opening.end + 1,
    );
    if (opening.name !== "script") {
      if (closing === null) break;
      cursor = closing.end;
      continue;
    }
    const isJsonLd =
      attr(opening.source, "type")?.trim().toLowerCase() ===
      "application/ld+json";
    if (closing === null) {
      return { validBlocks, malformedBlocks: errors, scanComplete: false };
    }
    if (!isJsonLd) {
      cursor = closing.end;
      continue;
    }
    if (inspected >= 100) {
      return { validBlocks, malformedBlocks: errors, scanComplete: false };
    }

    inspected += 1;
    const body = html.slice(opening.end + 1, closing.start);
    try {
      JSON.parse(body);
      validBlocks += 1;
    } catch {
      errors += 1;
    }
    cursor = closing.end;
  }
  return { validBlocks, malformedBlocks: errors, scanComplete: true };
}

const STRUCTURAL_RAW_TEXT_ELEMENTS = new Set([
  "script",
  "style",
  "textarea",
  "xmp",
  "noscript",
  "noembed",
  "noframes",
  "plaintext",
  "template",
  "svg",
  "canvas",
  "iframe",
]);

function safeProjectedTag(tag: string): string {
  if (tag.length < 2) return tag;
  return `${tag[0]}${tag
    .slice(1, -1)
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")}${tag.at(-1)}`;
}

function structuralHtml(html: string): string {
  const projected: string[] = [];
  let cursor = 0;
  while (cursor < html.length) {
    const nextTag = html.indexOf("<", cursor);
    if (nextTag < 0) {
      projected.push(html.slice(cursor));
      break;
    }
    projected.push(html.slice(cursor, nextTag));
    if (html.startsWith("<!--", nextTag)) {
      const commentEnd = html.indexOf("-->", nextTag + 4);
      if (commentEnd < 0) break;
      projected.push(" ");
      cursor = commentEnd + 3;
      continue;
    }
    const opening = openingTagAt(html, nextTag);
    if (opening.kind === "incomplete_named_tag") break;
    if (opening.kind === "not_a_named_tag") {
      const end = tagEnd(html, nextTag);
      if (end < 0) {
        projected.push(html.slice(nextTag));
        break;
      }
      projected.push(safeProjectedTag(html.slice(nextTag, end + 1)));
      cursor = end + 1;
      continue;
    }
    if (opening.name === "title") {
      const closing = closingTagAt(
        html,
        opening.name,
        opening.end + 1,
      );
      if (closing === null) {
        projected.push(safeProjectedTag(opening.source));
        projected.push(
          html.slice(opening.end + 1).replaceAll("<", "&lt;"),
        );
        break;
      }
      projected.push(safeProjectedTag(opening.source));
      projected.push(
        html
          .slice(opening.end + 1, closing.start)
          .replaceAll("<", "&lt;"),
      );
      projected.push("</title>");
      cursor = closing.end;
      continue;
    }
    if (!STRUCTURAL_RAW_TEXT_ELEMENTS.has(opening.name)) {
      projected.push(safeProjectedTag(opening.source));
      cursor = opening.end + 1;
      continue;
    }
    if (opening.name === "plaintext") {
      projected.push(" ");
      break;
    }
    const closing = closingTagAt(
      html,
      opening.name,
      opening.end + 1,
    );
    projected.push(" ");
    if (closing === null) break;
    cursor = closing.end;
  }
  return projected.join("");
}

function isHtmlContentType(contentType: string | null): boolean {
  if (contentType === null) return false;
  return /^\s*(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType);
}

function xRobotsNoindex(value: string | null): boolean {
  if (!value) return false;
  for (const rawDirective of value.toLowerCase().split(",")) {
    const directive = rawDirective.trim();
    if (!directive) continue;
    const colon = directive.indexOf(":");
    if (colon < 0) {
      if (directive === "noindex" || directive === "none") return true;
      continue;
    }
    const agent = directive.slice(0, colon).trim();
    if (agent !== "googlebot" && agent !== "google") continue;
    const scoped = directive
      .slice(colon + 1)
      .trim()
      .split(/\s+/);
    if (scoped.includes("noindex") || scoped.includes("none")) return true;
  }
  return false;
}

function metaRobotsNoindex(html: string): boolean {
  return [...html.matchAll(/<meta\b[^>]*>/gi)].some((match) => {
    const tag = match[0];
    const name = attr(tag, "name")?.trim().toLowerCase();
    if (name !== "robots" && name !== "googlebot") return false;
    const directives = (attr(tag, "content") ?? "")
      .toLowerCase()
      .split(/[\s,]+/)
      .filter(Boolean);
    return directives.includes("noindex") || directives.includes("none");
  });
}

function pageProbe(
  result: Extract<PublicResourceResult, { kind: "ok" }>,
): SeoAuditPageProbe {
  const decodeReliable =
    result.decodeState === "utf8" || result.decodeState === "utf8_prefix";
  const htmlAvailable =
    decodeReliable && isHtmlContentType(result.contentType);
  const structure = htmlAvailable ? structuralHtml(result.body) : "";
  const parsed = htmlAvailable
    ? parsePage(structure, result.finalUrl)
    : null;
  const prefixNoindex =
    xRobotsNoindex(result.xRobotsTag) ||
    (htmlAvailable && metaRobotsNoindex(structure)) ||
    (parsed ? !parsed.robotsIndexable : false);
  const jsonLd = htmlAvailable
    ? jsonLdEvidence(result.body)
    : { validBlocks: 0, malformedBlocks: 0, scanComplete: false };

  return {
    requestedUrl: result.requestedUrl,
    finalUrl: result.finalUrl,
    firstStatus: result.firstStatus,
    statusCode: result.finalStatus,
    redirectChain: result.redirectChain,
    contentType: result.contentType,
    bodyComplete: result.bodyComplete,
    decodeReliable,
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
    viewportConfigured:
      htmlAvailable && result.bodyComplete
        ? hasConfiguredViewport(structure)
        : htmlAvailable && hasConfiguredViewport(structure)
          ? true
          : null,
    hasMetaRefresh:
      htmlAvailable && result.bodyComplete
        ? hasMetaRefresh(structure)
        : htmlAvailable && hasMetaRefresh(structure)
          ? true
          : null,
    securityHeadersPresent: countSecurityHeaders(result.securityHeaders),
    socialMetaTagsPresent: htmlAvailable
      ? socialTagsPresent(structure)
      : 0,
    jsonLdBlockCount: jsonLd.validBlocks,
    jsonLdErrorCount: jsonLd.malformedBlocks,
    jsonLdScanComplete: jsonLd.scanComplete,
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
  if (statusCode === 404 || statusCode === 410) {
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
  if (
    result.decodeState === "unsupported_charset" ||
    result.decodeState === "invalid_utf8"
  ) {
    return {
      url,
      state: "decode_error",
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
    result.decodeState !== "utf8" ||
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
  const submittedPage = await fetchResource(url, {
    timeoutMs: PAGE_TIMEOUT_MS,
    maxRedirects: 5,
    maxBodyBytes: PAGE_BODY_CAP_BYTES,
  });
  if (submittedPage.kind === "error") {
    throw new SeoAuditScanError(pageFailureCode(submittedPage));
  }

  const page = pageProbe(submittedPage);
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
