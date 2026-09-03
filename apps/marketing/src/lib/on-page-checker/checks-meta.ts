// @input  -- the target page's extract (title, description, declared markup)
// @output -- the Meta and Content category checks, scored
// @pos    -- first two of the seven categories the checker reports
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import {
  displayWidth,
  SNIPPET_DESCRIPTION_WIDTH,
  SNIPPET_TITLE_WIDTH,
} from "@sf/public-tools/seo-audit/text-width";
import { check, observation, type CheckInput, type OnPageCheck } from "./check-types.ts";
import { BODY_UNITS as SHARED_BODY_UNITS } from "@sf/public-tools/seo-audit/page-shape-thresholds";

/**
 * The snippet bounds, now shared with the site-wide audit.
 *
 * They were 15–60 / 50–160 on display width here and 15–70 / 50–165 on raw
 * `.length` there, which let one title be flagged by one tool and cleared by
 * the other. One definition now, in `@sf/public-tools/seo-audit/text-width`.
 */
export const TITLE_LENGTH = SNIPPET_TITLE_WIDTH;
export const DESCRIPTION_LENGTH = SNIPPET_DESCRIPTION_WIDTH;
/**
 * Below this a page is thin enough that the rest of the checks say little.
 *
 * Measured in `text_units.v1` — a whitespace-separated word, or one CJK
 * character — so a Chinese page is graded rather than exempted. The same
 * numbers as before because the unit is the same one for Latin text; for CJK
 * the unit is a character, and the bands read as roughly the length of article
 * they name in either script.
 */
export { BODY_UNITS } from "@sf/public-tools/seo-audit/page-shape-thresholds";
/** Retained under the old name for the callers that still speak in words. */
export { BODY_UNITS as BODY_WORDS } from "@sf/public-tools/seo-audit/page-shape-thresholds";
/** Reviewed H1 width. A heading is a promise, not a paragraph. */
export const H1_WIDTH = { min: 10, max: 70 } as const;
/** Visible text as a share of markup. Below this the page is mostly chrome. */
export const TEXT_RATIO_FLOOR = 0.1;

/** `charset=` out of a `Content-Type` header, lower-cased, or null. */
export function charsetFromContentType(
  contentType: string | null,
): string | null {
  if (contentType === null) return null;
  const declared = contentType.match(/charset\s*=\s*"?([\w-]+)"?/i)?.[1];
  return declared === undefined ? null : declared.toLowerCase();
}

/**
 * Which encoding the page is actually decoded with, and whether it agrees.
 *
 * The header wins. This read the meta tag first while its own comment claimed
 * the opposite, so a page served `charset=utf-8` with `<meta charset=
 * "iso-8859-1">` was reported as declaring iso-8859-1 — the value that does not
 * govern the decoding. A conflict is worth a warn on its own: one of the two is
 * wrong and the author cannot tell which from the page.
 */
function charsetCheck(
  declared: string | null,
  contentType: string | null,
): OnPageCheck {
  const fromHeader = charsetFromContentType(contentType);
  const inMeta = declared?.trim().toLowerCase() ?? null;

  if (fromHeader !== null && inMeta !== null && fromHeader !== inMeta) {
    return check("charset", "meta", "warn", 1, 2, "charset.conflict", {
      header: fromHeader,
      meta: inMeta,
    });
  }
  if (fromHeader !== null) {
    return check("charset", "meta", "pass", 2, 2, "charset.fromHeader", {
      charset: fromHeader,
    });
  }
  if (inMeta !== null) {
    return check("charset", "meta", "pass", 2, 2, "charset.declared", {
      charset: inMeta,
    });
  }
  return check("charset", "meta", "warn", 0, 2, "charset.missing");
}

export function metaChecks(input: CheckInput): readonly OnPageCheck[] {
  const { extract } = input;
  const declared = extract.declared;
  const checks: OnPageCheck[] = [];

  const title = extract.title;
  if (title === null || title.trim() === "") {
    checks.push(check("title", "meta", "fail", 0, 6, "title.missing"));
  } else {
    const width = displayWidth(title);
    const withinRange = width >= TITLE_LENGTH.min && width <= TITLE_LENGTH.max;
    checks.push(
      check(
        "title",
        "meta",
        withinRange ? "pass" : "warn",
        withinRange ? 6 : 3,
        6,
        withinRange ? "title.ok" : "title.outsideRange",
        { title, width, min: TITLE_LENGTH.min, max: TITLE_LENGTH.max },
      ),
    );
  }

  const description = extract.metaDescription;
  if (description === null || description.trim() === "") {
    checks.push(
      check("description", "meta", "fail", 0, 5, "description.missing"),
    );
  } else {
    const width = displayWidth(description);
    const withinRange =
      width >= DESCRIPTION_LENGTH.min && width <= DESCRIPTION_LENGTH.max;
    checks.push(
      check(
        "description",
        "meta",
        withinRange ? "pass" : "warn",
        withinRange ? 5 : 3,
        5,
        withinRange ? "description.ok" : "description.outsideRange",
        {
          width,
          min: DESCRIPTION_LENGTH.min,
          max: DESCRIPTION_LENGTH.max,
        },
      ),
    );
  }

  const canonical = extract.response.canonicalTarget;
  if (canonical === null) {
    checks.push(check("canonical", "meta", "warn", 0, 3, "canonical.missing"));
  } else if (canonical === extract.url) {
    checks.push(
      check("canonical", "meta", "pass", 3, 3, "canonical.selfReferencing", {
        canonical,
      }),
    );
  } else {
    // A canonical pointing away is a deliberate choice on a duplicate and a
    // serious accident on the page someone is trying to rank. It scored a full
    // green pass, which reads as approval of the second case.
    checks.push(
      check("canonical", "meta", "warn", 1, 3, "canonical.pointsElsewhere", {
        canonical,
      }),
    );
  }

  // A noindex page can be perfectly built and still never appear. It is the one
  // meta check whose failure is not about degree.
  checks.push(
    extract.response.robotsIndexable
      ? check("robots", "meta", "pass", 3, 3, "robots.indexable", {
          directives: extract.response.robotsDirectives.join(", ") || "—",
        })
      : check("robots", "meta", "fail", 0, 3, "robots.noindex", {
          directives: extract.response.robotsDirectives.join(", ") || "—",
        }),
  );

  if (declared === null) {
    // The crawl did not carry the markup side-car. Unknown is reported as
    // unknown; scoring a page down for a fact we did not collect would be a
    // verdict about our own pipeline.
    checks.push(
      observation("viewport", "meta", "declaredUnavailable"),
      observation("charset", "meta", "declaredUnavailable"),
      observation("lang", "meta", "declaredUnavailable"),
      observation("favicon", "meta", "declaredUnavailable"),
    );
    return checks;
  }

  checks.push(
    declared.viewport === null
      ? check("viewport", "meta", "fail", 0, 3, "viewport.missing")
      : check("viewport", "meta", "pass", 3, 3, "viewport.declared", {
          viewport: declared.viewport,
        }),
    charsetCheck(declared.charset, extract.response.contentType),
    declared.lang === null
      ? check("lang", "meta", "warn", 0, 2, "lang.missing")
      : check("lang", "meta", "pass", 2, 2, "lang.declared", {
          lang: declared.lang,
        }),
    declared.faviconDeclared
      ? check("favicon", "meta", "pass", 1, 1, "favicon.declared")
      : check("favicon", "meta", "warn", 0, 1, "favicon.missing"),
  );

  return checks;
}

/**
 * How much the page actually says, in a unit every script has.
 *
 * Prefers `staticBodyUnits`, which counts CJK characters one each, so a Chinese
 * page is graded instead of falling through to "cannot be counted". The
 * whitespace word count is still what the copy shows when it exists, because
 * "1,200 words" is what a reader of an English page expects to read.
 */
function bodyLengthCheck(extract: CheckInput["extract"]): OnPageCheck {
  // Two wordings per band, because "1,200 words" and "1,200 characters" are
  // different sentences and interpolating the basis name would put an English
  // token into a Chinese report. Written out rather than assembled, so a key
  // that has no wording is visible in the source.
  const units = extract.staticBodyUnits;
  const words = extract.staticBodyWords;
  const measured = units?.units ?? words;
  if (measured === null || measured === undefined) {
    return observation("bodyWords", "content", "bodyWords.unavailable");
  }
  const detail = { words: measured };
  const inWords = (units?.basis ?? "words") === "words";
  if (measured < SHARED_BODY_UNITS.thin) {
    return check("bodyWords", "content", "fail", 0, 5,
      inWords ? "bodyWords.thin" : "bodyWords.thinUnits", detail);
  }
  if (measured < SHARED_BODY_UNITS.low) {
    return check("bodyWords", "content", "warn", 2, 5,
      inWords ? "bodyWords.low" : "bodyWords.lowUnits", detail);
  }
  if (measured < SHARED_BODY_UNITS.good) {
    return check("bodyWords", "content", "pass", 4, 5,
      inWords ? "bodyWords.fair" : "bodyWords.fairUnits", detail);
  }
  return check("bodyWords", "content", "pass", 5, 5,
    inWords ? "bodyWords.good" : "bodyWords.goodUnits", detail);
}

export function contentChecks(input: CheckInput): readonly OnPageCheck[] {
  const { extract } = input;
  const checks: OnPageCheck[] = [];

  const h1 = extract.h1;
  if (h1.length === 0) {
    checks.push(check("h1", "content", "fail", 0, 5, "h1.missing"));
  } else if (h1.length > 1) {
    // More than one H1 is legal HTML and still tells a crawler two different
    // things about what the page is.
    checks.push(
      check("h1", "content", "warn", 2, 5, "h1.multiple", {
        count: h1.length,
        first: h1[0] ?? "",
      }),
    );
  } else {
    const only = h1[0] ?? "";
    const width = displayWidth(only);
    // The extract cuts each heading to 200 characters, so a very long H1 is
    // reported at its cut width. That cannot flip the verdict — anything
    // reaching the cap is far past the upper bound either way — but the number
    // beside it is the cut one, and the copy says so.
    const clipped = extract.truncatedLists && only.length >= 200;
    const withinRange = width >= H1_WIDTH.min && width <= H1_WIDTH.max;
    checks.push(
      check(
        "h1",
        "content",
        withinRange ? "pass" : "warn",
        withinRange ? 5 : 3,
        5,
        withinRange
          ? "h1.single"
          : clipped
            ? "h1.tooLongClipped"
            : width < H1_WIDTH.min
              ? "h1.tooShort"
              : "h1.tooLong",
        { h1: only, width, min: H1_WIDTH.min, max: H1_WIDTH.max },
      ),
    );
  }

  checks.push(bodyLengthCheck(extract));

  const subHeadings = extract.subHeadings;
  if (subHeadings === null) {
    checks.push(
      observation("subHeadings", "content", "subHeadings.unavailable"),
    );
  } else if (subHeadings.length === 0) {
    checks.push(
      check("subHeadings", "content", "warn", 0, 3, "subHeadings.none"),
    );
  } else {
    checks.push(
      check("subHeadings", "content", "pass", 3, 3, "subHeadings.present", {
        count: subHeadings.length,
      }),
    );
  }

  const declared = extract.declared;
  if (declared === null) {
    checks.push(observation("textRatio", "content", "declaredUnavailable"));
    return checks;
  }

  if (declared.htmlBytes === 0) {
    checks.push(observation("textRatio", "content", "textRatio.unavailable"));
  } else {
    const ratio = declared.visibleTextBytes / declared.htmlBytes;
    const percent = Math.round(ratio * 1000) / 10;
    /*
      Observed, not graded.

      There is no documented ratio a page has to clear, and the Agent
      catalogue says so out loud: 4.4 publishes "listed for review, not
      judged". Scoring it here made the same measurement a defect on one
      surface and a neutral note on the other, for the same page, with nothing
      to tell a reader which was meant. The number is still worth showing --
      read it as a hint about rendering weight, never as a fault.
    */
    checks.push(
      observation(
        "textRatio",
        "content",
        ratio >= TEXT_RATIO_FLOOR ? "textRatio.healthy" : "textRatio.low",
        { percent },
      ),
    );
  }

  return checks;
}
