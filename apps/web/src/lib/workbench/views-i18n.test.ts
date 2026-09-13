import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../../../packages/i18n/src/messages/en.json";
import zh from "../../../../../packages/i18n/src/messages/zh-CN.json";

/**
 * Gate for the copy of the first five workbench views (PR-3 Task 1).
 *
 * Three deliberate choices, each of them a defect this file exists to catch:
 *
 * 1. `CASES` is a literal list. Deriving it from the JSON would make the test
 *    tautological — it would pass for whatever the files happen to contain.
 * 2. Every case is formatted WITH a values object. `t(key)` without values
 *    returns the raw message and never compiles the ICU, so a broken message
 *    would stay green; `{}` does compile, which is why a missing argument
 *    throws (see `enums-i18n.test.ts`).
 * 3. The residue check on the FORMATTED string only looks for leftover braces.
 *    It deliberately does not look for apostrophes: ICU treats `'` as a quote
 *    only in front of `{`, `}`, `#` or `|`, so `won't` and `site's` are legal
 *    copy and would false-positive. Quoting mistakes are caught instead on the
 *    RAW message by `opensIcuQuote`.
 */

const LOCALES = { en, "zh-CN": zh } as const;
type LocaleKey = keyof typeof LOCALES;
const LOCALE_KEYS = Object.keys(LOCALES) as readonly LocaleKey[];

const TEXT_SENTINEL = "SENTINEL-TEXT";
const NUMBER_SENTINEL = 7;
const BRACE_RESIDUE = /[{}]/;
const HAN = /\p{Script=Han}/u;

/**
 * Copy that would claim a result we never measured or an action that never
 * ran (repo CLAUDE.md honesty constraints, rulings Q16 / Q17 and codex #5).
 */
const FORBIDDEN: Readonly<Record<LocaleKey, readonly string[]>> = {
  "zh-CN": ["进前十", "保证", "一定能", "已修复", "无排名", "被引用率最高"],
  en: ["guarantee", "will rank", "not ranking", "we fixed", "page one within"],
};

/** Disclosures that must survive a copy edit (Q4 / Q6 / Q12 / Q24). */
const REQUIRED: Readonly<
  Record<string, Readonly<Record<LocaleKey, readonly string[]>>>
> = {
  "settings.notify.note": {
    "zh-CN": ["这个浏览器", "不会发送"],
    en: ["browser", "nothing is sent"],
  },
  "shell.clearSampleConfirm.body": {
    "zh-CN": ["GSC", "词库", "产物筐", "站点档案"],
    en: ["GSC", "keyword library", "artifacts", "site profile"],
  },
  "overview.loadDemo.confirmBody": {
    "zh-CN": ["GSC", "词库", "产物筐", "站点档案"],
    en: ["GSC", "keyword library", "artifacts", "site profile"],
  },
  "dataSources.table.unknownRank": {
    "zh-CN": ["排名未知"],
    en: ["unknown position"],
  },
  "dataSources.import.localNote": {
    "zh-CN": ["这个浏览器"],
    en: ["browser"],
  },
  "shell.siteCard.unknownHint": {
    "zh-CN": ["未知", "不等于未接入"],
    en: ["Unknown", "not the same as not connected"],
  },
};

/**
 * Subtrees this task owns end to end. Every leaf under them must be listed in
 * `CASES`, so a misspelt key cannot sit in both locales unnoticed (locale
 * parity alone is blind to a key no view ever reads).
 */
const OWNED_SUBTREES = [
  "overview",
  "week",
  "profile",
  "dataSources",
  "settings.notify",
  "settings.sources",
  "shell.clearSampleConfirm",
] as const;

/**
 * `key | arg arg` — each arg gets a text sentinel, `#arg` a numeric one. Keys
 * with no `|` are formatted with an empty values object, so adding an ICU
 * argument to one of them without updating this list throws.
 */
const CASES: readonly string[] = [
  "overview.subtitle | domain brand market",
  "overview.cards.health.label",
  "overview.cards.health.foot | #count",
  "overview.cards.mention.label",
  "overview.cards.mention.foot | #hits #total",
  "overview.cards.keywords.label",
  "overview.cards.keywords.foot | #count",
  "overview.cards.artifacts.label",
  "overview.cards.artifacts.foot",
  "overview.cards.unknown",
  "overview.gscFoot.sample",
  "overview.gscFoot.user",
  "overview.next.title",
  "overview.next.cta",
  "overview.next.step.audit",
  "overview.next.step.fixHigh | #count",
  "overview.next.step.visibility",
  "overview.next.step.answerGaps | #count",
  "overview.next.step.borderline | #count",
  "overview.next.step.matrix",
  "overview.next.step.importGsc",
  "overview.next.step.content",
  "overview.empty.title",
  "overview.empty.detail",
  "overview.loadDemo.button",
  "overview.loadDemo.busy",
  "overview.loadDemo.confirmTitle",
  "overview.loadDemo.confirmBody",
  "overview.loadDemo.confirmOk",
  "overview.loadDemo.cancel",
  "overview.noGsc.title",
  "overview.noGsc.detail",
  "overview.noGsc.cta",
  "week.subtitle | from to",
  "week.cards.health.label",
  "week.cards.health.foot | #fixed #added",
  "week.cards.mention.label",
  "week.cards.mention.foot | #hits #total",
  "week.cards.borderline.label",
  "week.cards.borderline.foot",
  "week.sinceLast | at",
  "week.summaryRow.artifacts | #count",
  "week.summaryRow.answerGaps | #count",
  "week.summaryRow.kbGaps | #count",
  "week.feed.title",
  "week.feed.count | #count",
  "week.feed.empty",
  "week.feed.view",
  "week.borderlineList.title",
  "week.borderlineList.empty",
  "week.borderlineList.detail",
  "week.next.title",
  "week.next.cta",
  "week.next.step.fixHigh | #count",
  "week.next.step.answerGaps | #count",
  "week.next.step.borderline | #count",
  "week.next.step.kbGaps | #count",
  "week.next.step.keepGoing",
  "week.report.title",
  "week.report.save",
  "week.report.export",
  "week.report.disabled",
  "week.artifactTitle | brand",
  "week.empty.title",
  "week.empty.detail",
  "profile.subtitle",
  "profile.fields.url",
  "profile.fields.brand",
  "profile.fields.market",
  "profile.fields.positioning",
  "profile.fields.features",
  "profile.fields.competitors",
  "profile.fields.positioningPlaceholder",
  "profile.fields.featuresPlaceholder",
  "profile.fields.competitorsPlaceholder",
  "profile.fields.charCount | #count",
  "profile.fields.itemCount | #count",
  "profile.readonlyNote",
  "profile.sources.title",
  "profile.sources.crawl",
  "profile.sources.gsc",
  "profile.sources.third",
  "profile.run.button",
  "profile.run.rerun",
  "profile.run.note",
  "profile.run.steps.crawl",
  "profile.run.steps.gsc",
  "profile.run.steps.third",
  "profile.run.steps.compose",
  "profile.tabs.doc",
  "profile.tabs.json",
  "profile.tabs.ctx",
  "profile.doc.stamp | at",
  "profile.doc.crawl",
  "profile.doc.gsc",
  "profile.doc.third",
  "profile.doc.product",
  "profile.doc.icp | #index",
  "profile.doc.lang",
  "profile.doc.stack",
  "profile.doc.h1",
  "profile.doc.hasPricing",
  "profile.doc.hasDocs",
  "profile.doc.hasBlog",
  "profile.doc.yes",
  "profile.doc.no",
  "profile.doc.gscTotal",
  "profile.doc.gscBrand",
  "profile.doc.gscBrandClicks",
  "profile.doc.gscNonBrandClicks",
  "profile.doc.gscNear",
  "profile.doc.gscTop",
  "profile.doc.gscNote",
  "profile.doc.summary",
  "profile.doc.valueProps",
  "profile.doc.diff",
  "profile.doc.pillars",
  "profile.doc.tone",
  "profile.doc.facts",
  "profile.doc.icpSeg",
  "profile.doc.icpRole",
  "profile.doc.icpPain",
  "profile.doc.icpTrigger",
  "profile.doc.icpObjection",
  "profile.doc.placeholderNote",
  "profile.metrics.pages",
  "profile.metrics.indexable",
  "profile.metrics.traffic",
  "profile.metrics.dr",
  "profile.metrics.refdomains",
  "profile.unknown",
  "profile.empty.title",
  "profile.empty.detail",
  "profile.artifactTitle.doc | brand",
  "profile.artifactTitle.json | brand",
  "profile.artifactTitle.ctx | brand",
  "profile.legacyCta",
  "dataSources.subtitle",
  "dataSources.real.title",
  "dataSources.real.gsc",
  "dataSources.real.ga4",
  "dataSources.real.connected",
  "dataSources.real.notConnected",
  "dataSources.real.unknown",
  "dataSources.real.unknownHint",
  "dataSources.real.needProfile",
  "dataSources.real.needProfileCta",
  "dataSources.real.otherError",
  "dataSources.real.manageLegacy",
  "dataSources.real.ga4NoConsumer",
  "dataSources.import.title",
  "dataSources.import.localNote",
  "dataSources.import.placeholder",
  "dataSources.import.parse",
  "dataSources.import.clear",
  "dataSources.import.clearConfirmTitle",
  "dataSources.import.clearConfirmBody",
  "dataSources.import.upload",
  "dataSources.import.uploadHint | limit",
  "dataSources.import.tooLarge | limit",
  "dataSources.import.truncated | #kept #total",
  "dataSources.result.parsed | #count",
  "dataSources.result.skipped | #count",
  "dataSources.result.noHeader",
  "dataSources.result.unrecognizedColumns | columns",
  "dataSources.table.title",
  "dataSources.table.count | #count",
  "dataSources.table.query",
  "dataSources.table.clicks",
  "dataSources.table.impressions",
  "dataSources.table.position",
  "dataSources.table.status",
  "dataSources.table.legend",
  "dataSources.table.showing | #shown #total",
  "dataSources.table.unknownRank | #count",
  "dataSources.table.toKeywords",
  "dataSources.empty.title",
  "dataSources.empty.detail",
  "settings.notify.title",
  "settings.notify.note",
  "settings.notify.weekly.label",
  "settings.notify.weekly.description",
  "settings.notify.drop.label",
  "settings.notify.drop.description",
  "settings.notify.mention.label",
  "settings.notify.mention.description",
  "settings.notify.gsc.label",
  "settings.notify.gsc.description",
  "settings.sources.title",
  "settings.sources.note",
  "settings.sources.cta",
  "settings.sources.legacyCta",
  "shell.clearSampleConfirm.title",
  "shell.clearSampleConfirm.body",
  "shell.clearSampleConfirm.ok",
  "shell.siteCard.unknownHint",
];

interface MessageCase {
  readonly key: string;
  readonly values: Readonly<Record<string, string | number>>;
}

function parseCase(spec: string): MessageCase {
  const [rawKey = "", rawArgs = ""] = spec.split("|");
  const names = rawArgs.trim().split(/\s+/u).filter(Boolean);
  return {
    key: rawKey.trim(),
    values: names.reduce<Readonly<Record<string, string | number>>>(
      (acc, name) =>
        name.startsWith("#")
          ? { ...acc, [name.slice(1)]: NUMBER_SENTINEL }
          : { ...acc, [name]: TEXT_SENTINEL },
      {},
    ),
  };
}

const PARSED: readonly MessageCase[] = CASES.map(parseCase);

/** Formats like the app would, but throws instead of rendering the key path. */
function formatStrict(
  locale: LocaleKey,
  key: string,
  values: Readonly<Record<string, string | number>>,
): string {
  const t = createTranslator({
    locale,
    messages: LOCALES[locale],
    namespace: "workbench",
    onError: (error) => {
      throw error;
    },
  });
  return t(key as never, values as never);
}

function node(locale: LocaleKey, path: string): unknown {
  return path
    .split(".")
    .reduce<unknown>(
      (current, segment) =>
        current !== null && typeof current === "object"
          ? (current as Record<string, unknown>)[segment]
          : undefined,
      (LOCALES[locale] as { readonly workbench: unknown }).workbench,
    );
}

function rawMessage(locale: LocaleKey, key: string): string {
  const value = node(locale, key);
  if (typeof value !== "string") {
    throw new Error(`${locale}: workbench.${key} is not a string message`);
  }
  return value;
}

function leafPaths(value: unknown, prefix: string): readonly string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.keys(value).flatMap((key) =>
    leafPaths((value as Record<string, unknown>)[key], `${prefix}.${key}`),
  );
}

/**
 * True when an apostrophe opens an ICU quoted run, which would swallow the
 * placeholder behind it. Doubled apostrophes are the escape for a literal `'`
 * and are removed first; a lone `'` anywhere else is plain English.
 */
function opensIcuQuote(raw: string): boolean {
  return /'[{}#|]/u.test(raw.replaceAll("''", ""));
}

describe.each(LOCALE_KEYS)("workbench view messages (%s)", (locale) => {
  it("compiles every listed key and inserts every argument", () => {
    for (const { key, values } of PARSED) {
      const text = formatStrict(locale, key, values);
      expect(text.trim(), key).not.toBe("");
      expect(text, key).not.toBe(key);
      expect(text, key).not.toBe(`workbench.${key}`);
      expect(text, key).not.toMatch(BRACE_RESIDUE);
      for (const value of Object.values(values)) {
        expect(text, `${key} must insert ${String(value)}`).toContain(
          String(value),
        );
      }
    }
  });

  it("has no apostrophe that opens an ICU quote", () => {
    for (const { key } of PARSED) {
      expect(opensIcuQuote(rawMessage(locale, key)), key).toBe(false);
    }
  });

  it("lists every message under the subtrees this task owns", () => {
    for (const subtree of OWNED_SUBTREES) {
      const found = leafPaths(node(locale, subtree), subtree);
      const listed = CASES.map((spec) => parseCase(spec).key).filter(
        (key) => key === subtree || key.startsWith(`${subtree}.`),
      );
      expect([...found].sort(), subtree).toEqual([...listed].sort());
    }
  });

  it("promises no ranking, no repair and no unmeasured citation", () => {
    for (const { key } of PARSED) {
      const raw = rawMessage(locale, key).toLowerCase();
      for (const phrase of FORBIDDEN[locale]) {
        expect(raw, `${key} must not claim "${phrase}"`).not.toContain(
          phrase.toLowerCase(),
        );
      }
    }
  });

  it("keeps the GSC import block free of sample labels", () => {
    for (const { key } of PARSED) {
      if (!key.startsWith("dataSources.import.")) continue;
      const raw = rawMessage(locale, key).toLowerCase();
      expect(raw, `${key} imports the user's own data`).not.toContain("示例");
      expect(raw, `${key} imports the user's own data`).not.toContain("sample");
    }
  });

  it("carries the disclosures that must survive a copy edit", () => {
    for (const [key, byLocale] of Object.entries(REQUIRED)) {
      const raw = rawMessage(locale, key);
      for (const phrase of byLocale[locale]) {
        expect(raw, `${key} must still say "${phrase}"`).toContain(phrase);
      }
    }
  });
});

describe("workbench view messages (en)", () => {
  it("reads as English, with no Chinese left in the catalogue", () => {
    for (const { key } of PARSED) {
      expect(HAN.test(rawMessage("en", key)), `en ${key}`).toBe(false);
    }
  });
});
