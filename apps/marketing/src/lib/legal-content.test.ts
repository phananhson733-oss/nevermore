import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  LEGAL_DOC_TYPES,
  LEGAL_LOCALES,
  getLocalLegalDocument,
  isLegalDocType,
  parseLegalMarkdown,
} from "./legal-content.ts";

const CONTENT_ROOT = join(process.cwd(), "apps/marketing/content/legal");

const VALID = `---
title: Privacy Policy
version: 1.0
effectiveDate: 2026-08-07
status: published
---

Body text.
`;

describe("parseLegalMarkdown", () => {
  it("reads scalar frontmatter and the body", () => {
    const { frontmatter, body } = parseLegalMarkdown(VALID, "privacy.md");
    expect(frontmatter).toEqual({
      title: "Privacy Policy",
      version: "1.0",
      effectiveDate: "2026-08-07",
      status: "published",
    });
    expect(body).toBe("Body text.");
  });

  it("strips matched surrounding quotes from a value", () => {
    const { frontmatter } = parseLegalMarkdown(
      VALID.replace("version: 1.0", 'version: "1.0"'),
    );
    expect(frontmatter.version).toBe("1.0");
  });

  for (const [name, source] of [
    ["no frontmatter at all", "Body only.\n"],
    ["unterminated frontmatter", "---\ntitle: X\nBody\n"],
    ["missing required field", VALID.replace("version: 1.0\n", "")],
    ["unknown status", VALID.replace("status: published", "status: live")],
    ["empty body", VALID.replace("Body text.\n", "")],
    ["duplicate field", VALID.replace("status:", "title: Other\nstatus:")],
  ] as const) {
    it(`rejects ${name}`, () => {
      expect(() => parseLegalMarkdown(source)).toThrow();
    });
  }

  // A date that passes the shape check but is not a real day would otherwise
  // render as "Invalid Date" on a page whose whole job is stating when it took
  // effect.
  it("rejects a well-shaped but impossible date", () => {
    expect(() =>
      parseLegalMarkdown(VALID.replace("2026-08-07", "2026-02-30")),
    ).toThrow();
  });
});

describe("isLegalDocType", () => {
  it("accepts exactly the four published document types", () => {
    for (const type of LEGAL_DOC_TYPES) expect(isLegalDocType(type)).toBe(true);
    expect(isLegalDocType("refunds")).toBe(false);
    expect(isLegalDocType("../../etc/passwd")).toBe(false);
  });
});

describe("getLocalLegalDocument", () => {
  it("refuses a doc type outside the allow-list rather than touching the path", async () => {
    // The argument reaches join() as a filename, so an unvalidated value would
    // be a traversal. Rejecting before the read is the whole guard.
    await expect(
      getLocalLegalDocument("../../../etc/passwd", "en"),
    ).resolves.toBeNull();
  });

  it("refuses an unknown locale", async () => {
    await expect(getLocalLegalDocument("privacy", "fr")).resolves.toBeNull();
    await expect(getLocalLegalDocument("privacy", "../en")).resolves.toBeNull();
  });

  /**
   * Every document the site links to must actually resolve.
   *
   * These shipped as drafts first and were published on 2026-08-07 after
   * review. A footer link to a policy that renders "coming soon" is the
   * failure this guards: `getLocalLegalDocument` answers null for a missing
   * file, a draft, and malformed frontmatter alike, so nothing else would
   * distinguish "not written yet" from "silently broken".
   */
  it("resolves a published document for every linked type and locale", async () => {
    for (const locale of LEGAL_LOCALES) {
      for (const docType of LEGAL_DOC_TYPES) {
        const doc = await getLocalLegalDocument(docType, locale);
        expect(doc, `${locale}/${docType}`).not.toBeNull();
        expect(doc?.doc_type).toBe(docType);
        expect(doc?.locale).toBe(locale);
        expect(doc?.title.trim()).not.toBe("");
        expect(doc?.content.length).toBeGreaterThan(400);
        expect(doc?.effective_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      }
    }
  });

  it("localises the title rather than shipping the English one twice", async () => {
    for (const docType of LEGAL_DOC_TYPES) {
      const en = await getLocalLegalDocument(docType, "en");
      const zh = await getLocalLegalDocument(docType, "zh");
      // Cookie 政策 legitimately keeps the English word "Cookie"; the rest must
      // differ outright, which catches a zh file copied from en and not translated.
      if (docType !== "cookies") {
        expect(zh?.title, docType).not.toBe(en?.title);
      }
      expect(zh?.content, docType).not.toBe(en?.content);
    }
  });
});

/**
 * Locale-correct internal links, asserted on the files themselves.
 *
 * Routing is next-intl `as-needed`: English lives at `/privacy`, Chinese at
 * `/zh/privacy`. A body link written as `/cookies` therefore drops a Chinese
 * reader onto the English page — which is exactly what the first draft of
 * these files did, and which nothing else in the pipeline would catch, because
 * the link resolves to a real page either way.
 */
describe("shipped document body links", () => {
  const INTERNAL_LINK = /\]\((\/[^)]*)\)/g;

  it("prefixes every Chinese internal link with the locale segment", async () => {
    for (const docType of LEGAL_DOC_TYPES) {
      const source = await readFile(
        join(CONTENT_ROOT, "zh", `${docType}.md`),
        "utf8",
      );
      for (const [, href] of source.matchAll(INTERNAL_LINK)) {
        expect(href, `zh/${docType}.md links to ${href}`).toMatch(
          /^\/zh(?:\/|$)/,
        );
      }
    }
  });

  it("leaves English internal links unprefixed", async () => {
    for (const docType of LEGAL_DOC_TYPES) {
      const source = await readFile(
        join(CONTENT_ROOT, "en", `${docType}.md`),
        "utf8",
      );
      for (const [, href] of source.matchAll(INTERNAL_LINK)) {
        expect(href, `en/${docType}.md links to ${href}`).not.toMatch(
          /^\/(?:zh|en)(?:\/|$)/,
        );
      }
    }
  });

  it("never links a document to itself", async () => {
    for (const locale of LEGAL_LOCALES) {
      for (const docType of LEGAL_DOC_TYPES) {
        const source = await readFile(
          join(CONTENT_ROOT, locale, `${docType}.md`),
          "utf8",
        );
        const self = locale === "en" ? `/${docType}` : `/${locale}/${docType}`;
        expect(source, `${locale}/${docType}.md`).not.toContain(`](${self})`);
      }
    }
  });
});
