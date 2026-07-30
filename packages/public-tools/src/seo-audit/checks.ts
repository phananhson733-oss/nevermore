import type {
  SeoAuditCheck,
  SeoAuditEvidence,
  SeoAuditEvidenceSource,
  SeoAuditModuleId,
  SeoAuditProbe,
  SeoAuditSeverity,
  SeoAuditStatus,
} from "./types.ts";

interface CatalogEntry {
  readonly id: string;
  readonly module: SeoAuditModuleId;
  readonly severity: SeoAuditSeverity;
  readonly weight: number;
}

const CATALOG: readonly CatalogEntry[] = [
  { id: "homepage_status", module: "crawlability", severity: "critical", weight: 4 },
  { id: "indexability", module: "crawlability", severity: "critical", weight: 4 },
  { id: "robots_access", module: "crawlability", severity: "high", weight: 2 },
  { id: "sitemap", module: "crawlability", severity: "high", weight: 2 },
  { id: "https", module: "technical", severity: "high", weight: 3 },
  { id: "redirects", module: "technical", severity: "medium", weight: 2 },
  { id: "html_content_type", module: "technical", severity: "high", weight: 2 },
  { id: "canonical", module: "technical", severity: "high", weight: 3 },
  { id: "html_lang", module: "technical", severity: "low", weight: 1 },
  { id: "title", module: "on_page", severity: "high", weight: 3 },
  { id: "meta_description", module: "on_page", severity: "medium", weight: 2 },
  { id: "h1", module: "on_page", severity: "high", weight: 3 },
  { id: "heading_order", module: "on_page", severity: "low", weight: 1 },
  { id: "text_depth", module: "content", severity: "medium", weight: 2 },
  { id: "internal_links", module: "content", severity: "medium", weight: 2 },
  { id: "social_meta", module: "content", severity: "low", weight: 1 },
  { id: "json_ld", module: "structured_data", severity: "medium", weight: 2 },
] as const;

function observed(
  source: SeoAuditEvidenceSource,
  rows: readonly Omit<SeoAuditEvidence, "source">[],
): readonly SeoAuditEvidence[] {
  return rows.map((row) => ({ ...row, source }));
}

function isHtml(contentType: string | null): boolean | null {
  if (contentType === null) return null;
  return /^\s*(?:text\/html|application\/xhtml\+xml)\b/i.test(contentType);
}

function headingsAreOrdered(outline: readonly string[]): boolean {
  return outline.every((tag, index) => {
    if (index === 0) return true;
    const previous = Number(outline[index - 1]?.slice(1));
    const current = Number(tag.slice(1));
    return current <= previous + 1;
  });
}

function bodyUnknown(probe: SeoAuditProbe): boolean {
  return (
    probe.page.statusCode < 200 ||
    probe.page.statusCode >= 300 ||
    isHtml(probe.page.contentType) === false ||
    !probe.page.bodyComplete
  );
}

function checkStatus(id: string, probe: SeoAuditProbe): SeoAuditStatus {
  const { page, robots, sitemap } = probe;
  const html = isHtml(page.contentType);
  const incomplete = !page.bodyComplete;
  switch (id) {
    case "homepage_status":
      if (page.statusCode >= 200 && page.statusCode < 300) return "pass";
      if (page.statusCode >= 400) return "fail";
      return "warning";
    case "indexability":
      if (page.robotsNoindex === true) return "fail";
      if (page.statusCode < 200 || page.statusCode >= 300) return "unverified";
      if (page.robotsNoindex === false) return "pass";
      return "unverified";
    case "robots_access":
      if (robots.state === "absent") return "pass";
      if (robots.state === "parsed") {
        if (probe.robotsPageAllowed === false) return "fail";
        if (probe.robotsPageAllowed === true) return "pass";
        return "unverified";
      }
      if (robots.state === "malformed" || robots.state === "empty") return "warning";
      return "unverified";
    case "sitemap":
      if (sitemap.state === "parsed") return "pass";
      if (sitemap.state === "missing") return "warning";
      if (
        sitemap.state === "malformed" ||
        sitemap.state === "empty"
      ) {
        return "warning";
      }
      return "unverified";
    case "https":
      return new URL(page.finalUrl).protocol === "https:" ? "pass" : "fail";
    case "redirects":
      if (page.redirectChain.length === 0) return "pass";
      return page.redirectChain.length === 1 ? "warning" : "fail";
    case "html_content_type":
      if (html === null) return "unverified";
      return html ? "pass" : "fail";
    case "canonical":
      if (page.statusCode < 200 || page.statusCode >= 300) return "unverified";
      if (html === false || (!page.canonical && incomplete)) return "unverified";
      if (!page.canonical) return "warning";
      return page.canonical === page.finalUrl ? "pass" : "fail";
    case "html_lang":
      if (page.statusCode < 200 || page.statusCode >= 300) return "unverified";
      if (html === false || (!page.htmlLang && incomplete)) return "unverified";
      return page.htmlLang ? "pass" : "warning";
    case "title":
      if (page.statusCode < 200 || page.statusCode >= 300) return "unverified";
      if (html === false || (!page.title && incomplete)) return "unverified";
      if (!page.title) return "fail";
      return page.title.length >= 30 && page.title.length <= 60
        ? "pass"
        : "warning";
    case "meta_description":
      if (page.statusCode < 200 || page.statusCode >= 300) return "unverified";
      if (html === false || (!page.metaDescription && incomplete)) {
        return "unverified";
      }
      if (!page.metaDescription) return "fail";
      return page.metaDescription.length >= 70 &&
        page.metaDescription.length <= 160
        ? "pass"
        : "warning";
    case "h1":
      if (page.statusCode < 200 || page.statusCode >= 300) return "unverified";
      if (html === false) return "unverified";
      if (incomplete) return page.h1Count > 1 ? "fail" : "unverified";
      if (page.h1Count === 0) return "fail";
      return page.h1Count === 1 ? "pass" : "warning";
    case "heading_order":
      if (bodyUnknown(probe) || page.headingOutline.length === 0) {
        return "unverified";
      }
      return headingsAreOrdered(page.headingOutline) ? "pass" : "warning";
    case "text_depth":
      if (page.statusCode < 200 || page.statusCode >= 300) return "unverified";
      if (html === false) return "unverified";
      if (incomplete) return page.wordCount >= 500 ? "pass" : "unverified";
      if (page.wordCount >= 500) return "pass";
      return page.wordCount >= 200 ? "warning" : "fail";
    case "internal_links":
      if (page.statusCode < 200 || page.statusCode >= 300) return "unverified";
      if (html === false) return "unverified";
      if (incomplete) {
        return page.internalLinkCount >= 3 ? "pass" : "unverified";
      }
      if (page.internalLinkCount >= 3) return "pass";
      return page.internalLinkCount > 0 ? "warning" : "fail";
    case "social_meta":
      if (page.statusCode < 200 || page.statusCode >= 300) return "unverified";
      if (html === false) return "unverified";
      if (incomplete) {
        return page.socialMetaTagsPresent === 4 ? "pass" : "unverified";
      }
      if (page.socialMetaTagsPresent === 4) return "pass";
      return "warning";
    case "json_ld":
      if (page.statusCode < 200 || page.statusCode >= 300) return "unverified";
      if (html === false) return "unverified";
      if (page.jsonLdErrorCount > 0) return "fail";
      if (page.jsonLdBlockCount > 0) return "pass";
      return "unverified";
    default:
      return "unverified";
  }
}

function limitation(
  id: string,
  status: SeoAuditStatus,
  probe: SeoAuditProbe,
): string | null {
  if (id === "sitemap" && probe.sitemap.state === "missing") {
    return "standard_path_only";
  }
  if (id === "json_ld" && probe.page.jsonLdBlockCount === 0) {
    return "static_html_cannot_prove_rendered_absence";
  }
  if (status === "unverified" && !probe.page.bodyComplete) {
    return "response_body_truncated";
  }
  if (status === "unverified" && isHtml(probe.page.contentType) === false) {
    return "html_body_unavailable";
  }
  if (
    status === "unverified" &&
    (probe.robots.state === "fetch_error" ||
      probe.sitemap.state === "fetch_error")
  ) {
    return "resource_fetch_unavailable";
  }
  return null;
}

function evidence(id: string, probe: SeoAuditProbe): readonly SeoAuditEvidence[] {
  const { page, robots, sitemap } = probe;
  switch (id) {
    case "homepage_status":
      return observed("submitted_page_static", [
        { label: "status_code", value: page.statusCode },
      ]);
    case "indexability":
      return observed("submitted_page_static", [
        { label: "robots_noindex", value: page.robotsNoindex },
        { label: "body_complete", value: page.bodyComplete },
      ]);
    case "robots_access":
      return observed("robots_txt", [
        { label: "resource_state", value: robots.state },
        { label: "status_code", value: robots.statusCode },
        { label: "page_allowed", value: probe.robotsPageAllowed },
      ]);
    case "sitemap":
      return observed("sitemap_xml", [
        { label: "resource_state", value: sitemap.state },
        { label: "status_code", value: sitemap.statusCode },
      ]);
    case "https":
      return observed("submitted_page_static", [
        { label: "final_protocol", value: new URL(page.finalUrl).protocol },
      ]);
    case "redirects":
      return observed("submitted_page_static", [
        { label: "redirect_hops", value: page.redirectChain.length },
      ]);
    case "html_content_type":
      return observed("submitted_page_static", [
        { label: "content_type", value: page.contentType },
      ]);
    case "canonical":
      return observed("submitted_page_static", [
        { label: "canonical_url", value: page.canonical },
        { label: "body_complete", value: page.bodyComplete },
      ]);
    case "html_lang":
      return observed("submitted_page_static", [
        { label: "html_lang", value: page.htmlLang },
      ]);
    case "title":
      return observed("submitted_page_static", [
        { label: "title_length", value: page.title?.length ?? null },
      ]);
    case "meta_description":
      return observed("submitted_page_static", [
        {
          label: "description_length",
          value: page.metaDescription?.length ?? null,
        },
      ]);
    case "h1":
      return observed("submitted_page_static", [
        { label: "h1_count", value: page.h1Count },
      ]);
    case "heading_order":
      return observed("submitted_page_static", [
        {
          label: "heading_outline",
          value: page.headingOutline.join(" > ") || null,
        },
      ]);
    case "text_depth":
      return observed("submitted_page_static", [
        { label: "static_word_count", value: page.wordCount },
      ]);
    case "internal_links":
      return observed("submitted_page_static", [
        { label: "static_internal_links", value: page.internalLinkCount },
      ]);
    case "social_meta":
      return observed("submitted_page_static", [
        {
          label: "social_tags_present",
          value: page.socialMetaTagsPresent,
        },
      ]);
    case "json_ld":
      return observed("submitted_page_static", [
        { label: "json_ld_blocks", value: page.jsonLdBlockCount },
        { label: "malformed_blocks", value: page.jsonLdErrorCount },
      ]);
    default:
      return [];
  }
}

export function buildSeoAuditChecks(
  probe: SeoAuditProbe,
): readonly SeoAuditCheck[] {
  return CATALOG.map((entry) => {
    const status = checkStatus(entry.id, probe);
    return {
      ...entry,
      status,
      evidence: evidence(entry.id, probe),
      limitation: limitation(entry.id, status, probe),
    };
  });
}
