import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { getConnectedToolContent } from "../../components/tools/connected-tool-content.ts";
import { getQuickWinsArticle } from "../../components/tools/seo-quick-wins-article-content.ts";

/**
 * The honesty claim this file guards.
 *
 * These tools used to hold nothing at all past the hour an access token lived,
 * so "nothing stored" was a complete sentence. It no longer is: the Google
 * authorization now persists, encrypted, in a cookie in the visitor's own
 * browser. Nothing moved to a server — there is still no database, no KV store
 * and no session table — but a bare "nothing stored" now reads as a claim about
 * the visitor's browser too, and that claim is false.
 *
 * So every storage sentence has to say WHERE. That is the difference between
 * copy that survives someone reading their own cookie jar and copy that does
 * not.
 */
function bundle(locale: "en" | "zh", namespace: "quickWins" | "trafficDrop") {
  const path = fileURLToPath(
    new URL(`../../i18n/messages/${locale}.json`, import.meta.url),
  );
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    tools: Record<string, Record<string, string>>;
  };
  const messages = parsed.tools[namespace];
  if (!messages) throw new Error(`missing tools.${namespace} in ${locale}`);
  return messages;
}

const LOCALES = ["en", "zh"] as const;
const NAMESPACES = ["quickWins", "trafficDrop"] as const;

const CASES = LOCALES.flatMap((locale) =>
  NAMESPACES.map((namespace) => [locale, namespace] as const),
);

describe("public tool copy about what is stored", () => {
  it.each(CASES)(
    "never makes an unqualified storage claim in %s tools.%s",
    (locale, namespace) => {
      const text = JSON.stringify(bundle(locale, namespace));

      for (const pattern of forbiddenStorageClaims(locale)) {
        expect(text, `${locale}.${namespace} matches ${pattern}`).not.toMatch(
          pattern,
        );
      }
    },
  );

  it.each(CASES)(
    "tells %s tools.%s visitors the authorization stays in their own browser",
    (locale, namespace) => {
      // The one thing that now persists has to be named where the visitor is
      // deciding whether to authorize, not in a policy page they will not open.
      const body = bundle(locale, namespace).connectBody ?? "";
      expect(body.toLowerCase()).toContain("cookie");
      expect(body).toMatch(locale === "en" ? /your own browser/i : /浏览器/);
    },
  );

  it.each(CASES)(
    "names no lifetime for the %s tools.%s authorization",
    (locale, namespace) => {
      // Our cookie's own life is a number we control. The Google grant behind it
      // is not: while the consent screen is in Testing, Google expires refresh
      // tokens after 7 days. Any duration in visitor-facing copy would be a
      // promise about someone else's system.
      const messages = bundle(locale, namespace);
      for (const key of ["connectBody", "connectTrust", "unverifiedScope"]) {
        const value = messages[key] ?? "";
        expect(value, `${locale}.${namespace}.${key}`).not.toMatch(
          /\b(?:7|30|90)\s*(?:days?|天)/i,
        );
      }
    },
  );
});

/**
 * The unqualified-claim patterns, in one place.
 *
 * They were duplicated per describe block, which is how the long-form article
 * came to carry "Nothing is stored, so the export is the copy that survives"
 * on the very page whose connect copy had been requalified: the guard scanned
 * the i18n bundles and the page content object, and that file is neither.
 * Every surface a visitor reads about storage on now runs the same list.
 */
function forbiddenStorageClaims(locale: "en" | "zh"): readonly RegExp[] {
  return locale === "en"
    ? [
        // A universal "nothing" is what breaks: true of our servers, false of
        // the visitor's browser now that the authorization lives there.
        /nothing (?:is )?stored(?! on our servers)/i,
        /stores nothing(?! on our servers)/i,
        /we store nothing(?! on our servers)/i,
      ]
    : [
        // 「零存储」and 「不保存任何…」with nothing after them saying where.
        // 「不保存你的结果」is deliberately absent: results really are stored
        // nowhere, and only the authorization needs the qualifier.
        /零存储/,
        /不存储(?!在我们)/,
        /不保存任何/,
      ];
}

describe("connected tool page copy about what is stored", () => {
  it.each(LOCALES)("qualifies every storage claim in %s", (locale) => {
    const text = JSON.stringify(
      getConnectedToolContent(locale, "seo-quick-wins"),
    );

    for (const pattern of forbiddenStorageClaims(locale)) {
      expect(text, `${locale} matches ${pattern}`).not.toMatch(pattern);
    }
  });

  it.each(LOCALES)(
    "answers the %s storage question by naming the one thing that persists",
    (locale) => {
      const content = getConnectedToolContent(locale, "seo-quick-wins");
      const answer = content.faq.find((entry) =>
        locale === "en"
          ? entry.question.includes("store my data")
          : entry.question.includes("保存我的数据"),
      )?.answer;

      expect(answer).toBeDefined();
      // "Nothing is written to a database" stays true and stays. What must be
      // added is the authorization itself — a visitor who finds the cookie
      // afterwards should find it already described here.
      expect(answer?.toLowerCase()).toContain("cookie");
    },
  );
});

describe("long-form article copy about what is stored", () => {
  // The page that carries the connect panel also carries several thousand
  // words below it, and a reader reaches the article after the panel, not
  // instead of it. A guard that scans only the bundle and the page object
  // leaves the longest surface on the page unchecked — which is exactly where
  // the unqualified claim survived.
  it.each(LOCALES)(
    "qualifies every storage claim in the %s article",
    (locale) => {
      const text = JSON.stringify(getQuickWinsArticle(locale));

      for (const pattern of forbiddenStorageClaims(locale)) {
        expect(text, `${locale} article matches ${pattern}`).not.toMatch(
          pattern,
        );
      }
    },
  );

  it("scans the article the page actually renders, drafts or no drafts", () => {
    // `draftsEnabled: false` drops paragraphs, so a claim living in a dropped
    // one would pass the default scan and ship on every other deployment.
    for (const locale of LOCALES) {
      const text = JSON.stringify(
        getQuickWinsArticle(locale, { draftsEnabled: false }),
      );
      for (const pattern of forbiddenStorageClaims(locale)) {
        expect(text, `${locale} matches ${pattern}`).not.toMatch(pattern);
      }
    }
  });
});
