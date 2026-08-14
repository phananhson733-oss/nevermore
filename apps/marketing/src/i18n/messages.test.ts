import { describe, expect, it } from "vitest";
import enMessages from "./messages/en.json";
import zhMessages from "./messages/zh.json";

const SEO_AUDIT_EVIDENCE_KEYS = [
  "fetched",
  "groups_observed",
  "sitemap_references",
  "urls_observed",
  "initial_status",
  "final_status",
  "redirect_hops",
  "final_url",
  "final_protocol",
  "robots_directive",
  "canonical_target",
  "page_subject",
  "title",
  "matching_pages",
  "meta_description",
  "h1_count",
  "sitemap_member",
  "observed_inbound_links",
  "observed_source_pages",
  "malformed_blocks",
  "types_observed",
] as const;

function leafPaths(value: unknown, prefix = ""): readonly string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value).flatMap(([key, child]) =>
    leafPaths(child, prefix ? `${prefix}.${key}` : key),
  );
}

describe("message catalogs", () => {
  /**
   * next-intl renders the key path instead of throwing when a key is missing,
   * so an untranslated key ships as the literal text `prompts.detail.copy` on a
   * production page. Nothing else catches that: type-checking does not see
   * message keys, and a test asserting a translated string "appears on the
   * page" passes just as happily against the key path.
   *
   * Checked across the whole catalog rather than per namespace, so a new
   * namespace is covered the day it is added.
   */
  it("keeps every key present in both locales", () => {
    const en = [...leafPaths(enMessages)].sort();
    const zh = [...leafPaths(zhMessages)].sort();

    expect(en.filter((key) => !zh.includes(key))).toEqual([]);
    expect(zh.filter((key) => !en.includes(key))).toEqual([]);
  });
});

describe("SEO Audit message catalogs", () => {
  it("keeps the complete English and Chinese SEO Audit key shapes aligned", () => {
    expect([...leafPaths(enMessages.tools.seoAudit)].sort()).toEqual(
      [...leafPaths(zhMessages.tools.seoAudit)].sort(),
    );
  });

  it.each([
    ["en", enMessages],
    ["zh", zhMessages],
  ] as const)("contains every audit evidence label in %s", (_, messages) => {
    const evidence = messages.tools.seoAudit.evidence as Record<
      string,
      unknown
    >;

    for (const key of SEO_AUDIT_EVIDENCE_KEYS) {
      expect(evidence[key]).toEqual(expect.any(String));
    }
  });

  it("removes the legacy score, priority, diagnosis, and recommendation keys", () => {
    const keys = Object.keys(enMessages.tools.seoAudit);
    for (const removed of [
      "scoreLabel",
      "moduleScoreLabel",
      "priorities",
      "priorityListTitle",
      "diagnosisLabel",
      "recommendationLabel",
      "verificationLabel",
      "severities",
    ]) {
      expect(keys).not.toContain(removed);
    }
  });
});
