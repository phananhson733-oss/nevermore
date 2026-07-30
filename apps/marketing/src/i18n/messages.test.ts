import { describe, expect, it } from "vitest";
import enMessages from "./messages/en.json";
import zhMessages from "./messages/zh.json";

const SEO_AUDIT_EVIDENCE_KEYS = [
  "status_code",
  "robots_noindex",
  "body_complete",
  "decode_reliable",
  "resource_state",
  "page_allowed",
  "final_protocol",
  "redirect_hops",
  "content_type",
  "canonical_url",
  "html_lang",
  "viewport_configured",
  "meta_refresh_present",
  "security_headers_present",
  "title_length",
  "description_length",
  "h1_count",
  "heading_outline",
  "static_word_count",
  "social_tags_present",
  "json_ld_blocks",
  "malformed_blocks",
  "scan_complete",
] as const;

describe("SEO Audit message catalogs", () => {
  it.each([
    ["en", enMessages],
    ["zh", zhMessages],
  ] as const)("contains every observed evidence label in %s", (_, messages) => {
    const evidence = messages.tools.seoAudit.evidence as Record<
      string,
      unknown
    >;

    for (const key of SEO_AUDIT_EVIDENCE_KEYS) {
      expect(evidence[key]).toEqual(expect.any(String));
    }
  });
});
