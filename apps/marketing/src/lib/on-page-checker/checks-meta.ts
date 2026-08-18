// @input  -- the target page's extract (title, description, declared markup)
// @output -- the Meta and Content category checks, scored
// @pos    -- first two of the seven categories the checker reports
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { check, observation, type CheckInput, type OnPageCheck } from "./check-types.ts";

/**
 * Reviewed working ranges, not official limits.
 *
 * Google truncates by rendered pixel width, not by character count, so these
 * only flag lengths far enough outside common practice to be worth a look. CJK
 * characters count as two, because they occupy roughly twice the width.
 *
 * These are NOT the site-wide audit's bounds: `model.ts` flags 15–70 / 50–165
 * measured on raw `.length`. Two tools, two conventions, one product — so a
 * title can be flagged here and not there. Worth reconciling; recorded rather
 * than quietly assumed away.
 */
export const TITLE_LENGTH = { min: 15, max: 60 } as const;
export const DESCRIPTION_LENGTH = { min: 50, max: 160 } as const;
/** Below this a page is thin enough that the rest of the checks say little. */
export const BODY_WORDS = { thin: 300, low: 600, good: 1200 } as const;
/** Visible text as a share of markup. Below this the page is mostly chrome. */
export const TEXT_RATIO_FLOOR = 0.1;

/** Width in the sense the length bounds are written in: CJK counts as two. */
export function displayWidth(value: string): number {
  let width = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    width +=
      (code >= 0x1100 && code <= 0x115f) ||
      (code >= 0x2e80 && code <= 0xa4cf) ||
      (code >= 0xac00 && code <= 0xd7a3) ||
      (code >= 0xf900 && code <= 0xfaff) ||
      (code >= 0xfe30 && code <= 0xfe6f) ||
      (code >= 0xff00 && code <= 0xff60) ||
      (code >= 0xffe0 && code <= 0xffe6) ||
      (code >= 0x20000 && code <= 0x3fffd)
        ? 2
        : 1;
  }
  return width;
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
    declared.charset === null
      ? check("charset", "meta", "warn", 0, 2, "charset.missing")
      : check("charset", "meta", "pass", 2, 2, "charset.declared", {
          charset: declared.charset,
        }),
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
    checks.push(
      check("h1", "content", "pass", 5, 5, "h1.single", {
        h1: only,
        width: displayWidth(only),
      }),
    );
  }

  const words = extract.staticBodyWords;
  if (words === null) {
    // Withheld upstream because a whitespace count would be wrong by orders of
    // magnitude on this page. An absent number can be explained.
    checks.push(observation("bodyWords", "content", "bodyWords.unavailable"));
  } else if (words < BODY_WORDS.thin) {
    checks.push(
      check("bodyWords", "content", "fail", 0, 5, "bodyWords.thin", { words }),
    );
  } else if (words < BODY_WORDS.low) {
    checks.push(
      check("bodyWords", "content", "warn", 2, 5, "bodyWords.low", { words }),
    );
  } else if (words < BODY_WORDS.good) {
    checks.push(
      check("bodyWords", "content", "pass", 4, 5, "bodyWords.fair", { words }),
    );
  } else {
    checks.push(
      check("bodyWords", "content", "pass", 5, 5, "bodyWords.good", { words }),
    );
  }

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
    checks.push(
      ratio >= TEXT_RATIO_FLOOR
        ? check("textRatio", "content", "pass", 3, 3, "textRatio.healthy", {
            percent,
          })
        : check("textRatio", "content", "warn", 1, 3, "textRatio.low", {
            percent,
          }),
    );
  }

  return checks;
}
