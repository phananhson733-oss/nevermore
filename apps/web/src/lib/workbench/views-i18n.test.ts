import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import en from "../../../../../packages/i18n/src/messages/en.json";
import zh from "../../../../../packages/i18n/src/messages/zh-CN.json";
import { ARTIFACT_ACTION_LABEL_KEYS } from "@/components/workbench/ui/ArtifactActions";

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
 *
 * What this gate does and does not prove. It proves each listed key exists in
 * both locales, compiles, inserts every argument it is given, and still
 * CONTAINS the pinned words of a disclosure — so it catches the realistic
 * drift: a hedge deleted, or a clause shortened away. It does NOT prove the
 * copy is honest. `toContain` cannot tell "the sentence contains this word"
 * from "the sentence asserts it", so a rewrite that keeps the pinned words and
 * negates around them ("这些 GSC 行不是示例数据") survives unless that key also
 * carries a `FORBIDDEN_BY_KEY` rule. It also cannot see two arguments SWAPPED,
 * because en and zh legitimately order them differently; the keys that matters
 * for are listed in `SWAP_PRONE_KEYS`, whose order belongs to the consuming
 * view's own test. A green run here means the catalogue is well formed, not
 * that a human has read it.
 *
 * On length: over the repo's 400-line guidance, because the literal key list
 * belongs next to the assertions that consume it. ~200 of the lines below are
 * that list; splitting it out is recorded in the PR-3 residual table.
 */

const LOCALES = { en, "zh-CN": zh } as const;
type LocaleKey = keyof typeof LOCALES;
const LOCALE_KEYS = Object.keys(LOCALES) as readonly LocaleKey[];

/**
 * One sentinel per argument NAME, so a message that drops one of several
 * placeholders fails instead of matching a shared value. Numbers stay in the
 * hundreds: below 1000 so ICU `#` renders them without a grouping separator,
 * and away from the literals the copy itself contains (`11-30`, `≤10`, `GA4`).
 */
const textSentinel = (name: string): string => `SENTINEL-${name}`;
const numberSentinel = (index: number): number => 401 + index;
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

/**
 * Rules a required substring cannot express, because they are about what the
 * sentence must NOT do. Two shapes live here:
 *
 * - Negation of a pinned assertion. `overview.gscFoot.sample` is Q6's sample
 *   footnote; keeping the words and inverting the claim is the one rewrite that
 *   matters, so the negators are banned outright for that key.
 * - Q4's "an unattributable failure must not name a cause". The neutral
 *   messages may not carry a causal connective or a named cause.
 *   `dataSources.real.needProfile` is deliberately NOT in here: an incomplete
 *   product profile is the one cause we can actually attribute.
 *   `artifactActions.copyFailed` is the same rule on a different subsystem: a
 *   refused clipboard reaches the component as one bare `catch`, and a denied
 *   permission, a lost focus, a browser policy and a non-secure context are
 *   indistinguishable inside it — so naming any one of them is a coin flip
 *   presented as a diagnosis.
 */
const FORBIDDEN_BY_KEY: Readonly<
  Record<string, Readonly<Record<LocaleKey, readonly string[]>>>
> = {
  "overview.gscFoot.sample": {
    "zh-CN": ["不是示例", "并非示例", "不来自示例", "不是来自示例"],
    en: ["not come from sample", "no longer", "not sample data"],
  },
  "dataSources.real.otherError": {
    "zh-CN": ["所以", "因为", "由于", "过期", "权限", "配额", "授权"],
    en: [
      "because",
      "expired",
      "denied",
      "insufficient",
      "permission",
      "quota",
      "authoriz",
    ],
  },
  "dataSources.real.unknownHint": {
    "zh-CN": ["所以", "因为", "由于", "过期", "权限", "配额", "授权"],
    en: [
      "because",
      "expired",
      "denied",
      "insufficient",
      "permission",
      "quota",
      "authoriz",
    ],
  },
  "shell.siteCard.unknownHint": {
    "zh-CN": ["所以", "因为", "由于", "过期", "权限", "配额", "授权"],
    en: [
      "because",
      "expired",
      "denied",
      "insufficient",
      "permission",
      "quota",
      "authoriz",
    ],
  },
  // The loader's one `catch` cannot tell a chunk that failed to download from
  // a sample builder that threw, so the message may name neither (Q4's rule).
  "overview.loadDemo.failed": {
    "zh-CN": ["所以", "因为", "由于", "网络", "离线", "版本"],
    en: ["because", "network", "offline", "version", "connection"],
  },
  "artifactActions.copyFailed": {
    "zh-CN": [
      "所以",
      "因为",
      "由于",
      "权限",
      "拒绝",
      "禁止",
      "授权",
      "策略",
      "焦点",
      "安全上下文",
      "不支持",
    ],
    en: [
      "because",
      "denied",
      "refused",
      "blocked",
      "permission",
      "policy",
      "insecure",
      "not supported",
      "unsupported",
      "focus",
    ],
  },
  // Q37: nothing was stored. Softening the refusal into a partial save ("saved
  // the first part") would describe exactly the silent truncation Q37 removed.
  "artifactActions.tooLarge": {
    "zh-CN": ["已存入", "已保存", "截断", "部分", "前面"],
    en: ["saved", "truncat", "partial", "first part"],
  },
  // Nothing was stored, and nothing was pushed out. A rewrite that says the
  // save went through, or that an older artifact made way for it, describes the
  // silent eviction this refusal replaced.
  "artifactActions.basketFull": {
    "zh-CN": ["已存入", "已保存", "替换", "覆盖", "最早", "挤掉"],
    en: ["saved", "replac", "oldest", "overwr", "evict"],
  },
};

/**
 * Keys whose arguments this layer cannot pin the ORDER of: every argument is
 * present, so a swap renders a wrong sentence with no missing sentinel (e.g.
 * "402 次问答里有 401 次提到你" — more mentions than answers). en and zh order
 * them differently by design, so the assertion belongs in the view test that
 * renders the sentence with distinguishable values.
 */
const SWAP_PRONE_KEYS = [
  "overview.subtitle",
  "overview.cards.mention.foot",
  "week.subtitle",
  "week.cards.health.foot",
  "week.cards.mention.foot",
  "dataSources.import.truncated",
  "dataSources.table.showing",
] as const;

/**
 * Disclosures that must survive a copy edit (Q4 / Q6 / Q12 / Q16 / Q17 / Q24).
 *
 * `FORBIDDEN` is a blacklist and can only catch a lie being added; this table
 * is the only thing that catches a true sentence being deleted or watered
 * down, so every message that is the ONLY place a hedge is stated belongs
 * here. Pins are the load-bearing clause, not the whole sentence, so the
 * wording can still be improved — and they are checked on the FORMATTED text
 * of every plural branch, because a pin on the raw message is satisfied by one
 * branch keeping the hedge while the branch that actually renders drops it.
 */
const REQUIRED: Readonly<
  Record<string, Readonly<Record<LocaleKey, readonly string[]>>>
> = {
  "settings.notify.note": {
    "zh-CN": ["这个浏览器", "不会发送"],
    en: ["browser", "nothing is sent"],
  },
  // `clearDemo` rolls back every field `loadDemo` writes (`demoFields`), so the
  // body has to name all of them: the stores, the results already there, and the
  // trailing clause covering what the user produced after loading the sample. A
  // body that names only the four stores reads as if audit and visibility
  // results survive the clear.
  "shell.clearSampleConfirm.body": {
    "zh-CN": [
      "GSC",
      "关键词种子",
      "词库",
      "产物筐",
      "站点档案",
      "审计",
      "可见度",
      "知识库",
      "竞品数据",
      "答案页方案",
      "外链目标",
      "载入示例之后",
      "你自己加的内容",
    ],
    en: [
      "GSC",
      "keyword seeds",
      "keyword library",
      "saved artifacts",
      "site profile",
      "audit",
      "visibility",
      "knowledge base",
      "competitor data",
      "answer plans",
      "link targets",
      "after loading the sample",
      "anything you added",
    ],
  },
  // Q11 raises this dialog for any non-empty field, so the four named
  // categories are not enough: EVERY category the catch-all names is pinned,
  // or the clause can be trimmed back to two of six and stay green.
  "overview.loadDemo.confirmBody": {
    "zh-CN": [
      "GSC",
      "词库",
      "产物筐",
      "站点档案",
      "已有的运行结果",
      "审计",
      "可见度",
      "知识库",
      "竞品数据",
      "答案页方案",
      "外链目标",
    ],
    en: [
      "GSC",
      "keyword library",
      "artifacts",
      "site profile",
      "every result already there",
      "audit",
      "knowledge base",
      "competitor data",
      "answer plans",
      "link targets",
      "visibility",
    ],
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
  // Q16: the only sentence telling the reader the crawl never happened.
  "profile.subtitle": {
    "zh-CN": ["本地生成", "不是对你站点的真实抓取"],
    en: ["generated locally", "not a real crawl"],
  },
  "profile.run.note": {
    "zh-CN": ["不抓取你的站点", "不调用外部服务"],
    en: ["does not crawl your site", "no external service"],
  },
  // Q17: the whole justification for showing a list instead of rank movement.
  "week.borderlineList.detail": {
    "zh-CN": ["不是排名变化", "工作台目前不保存"],
    en: ["not rank movement", "does not keep"],
  },
  // Q6: the sample-provenance footnote. Pinned as the whole clause INCLUDING
  // its verb, because pinning the noun alone is satisfied by its own negation
  // ("这些 GSC 行不是示例数据"); `FORBIDDEN_BY_KEY` bans the negators as well.
  // The "no sample label" check on the import block runs the other way round
  // and cannot catch either shape.
  "overview.gscFoot.sample": {
    "zh-CN": ["来自示例数据"],
    en: ["come from sample data"],
  },
  // Q4: a failure we cannot attribute must not name a cause.
  "dataSources.real.otherError": {
    "zh-CN": ["读不到连接状态"],
    en: ["could not be read"],
  },
  // Pinned on its own: being byte-identical to shell.siteCard.unknownHint is
  // not protection, and this is the one page showing all three states at once.
  "dataSources.real.unknownHint": {
    "zh-CN": ["未知", "不等于未接入"],
    en: ["Unknown", "not the same as not connected"],
  },
  // The real, server-side record must be called what its own page calls
  // itself: /context reads `productProfile.*`, whose heroEyebrow is
  // 「产品画像 · ICP」 / "PRODUCT PROFILE · ICP". A CTA naming the destination
  // anything else sends the reader looking for a page that does not exist.
  "profile.legacyCta": {
    "zh-CN": ["产品画像"],
    en: ["product profile"],
  },
  "dataSources.real.needProfile": {
    "zh-CN": ["产品画像"],
    en: ["product profile"],
  },
  "dataSources.real.needProfileCta": {
    "zh-CN": ["产品画像"],
    en: ["product profile"],
  },
  "profile.readonlyNote": {
    "zh-CN": ["产品画像"],
    en: ["product profile"],
  },
  // Q4 bans the cause, which leaves "没能复制" — a dead end unless the sentence
  // also says what to do instead. The pin is on that clause, not on the half
  // that reports the failure: an instruction cannot become untrue later, so
  // pinning it cannot mandate a lie the way pinning a claim about state can.
  "artifactActions.copyFailed": {
    "zh-CN": ["手动选中"],
    en: ["copy it yourself"],
  },
  // Q37: the only sentence telling the operator the basket did NOT take the
  // text, and the only place the way out is named. Both clauses are pinned: the
  // refusal alone is a dead end, the way out alone reads like a tip.
  "artifactActions.tooLarge": {
    "zh-CN": ["存不进产物筐", "导出或复制"],
    en: ["Too large to save", "export it or copy it"],
  },
  // The one cause is known and named (the basket is full), and so is the way
  // out. Each clause is pinned: the cause alone is a dead end, the way out alone
  // does not say why nothing was stored, and "copy or export" is the part that
  // stops the reader thinking the text is lost.
  "artifactActions.basketFull": {
    "zh-CN": ["产物筐已满", "删掉几件", "复制和导出"],
    en: ["Artifacts is full", "Remove a few", "copy or export"],
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
  "artifactActions",
  "panes",
] as const;

/**
 * Subtrees whose members are rendered TOGETHER, so two of them sharing a
 * spelling is a defect no other rule here can see. `ArtifactActions` puts four
 * buttons in one footer row and flashes `copied` / `saved` into one shared
 * `role="status"`; `InPane` / `OutPane` tag the two halves of one screen. A
 * `copyForAi` shortened back to "复制" / "Copy" leaves two adjacent buttons that
 * read the same and do different things — every other check in this file stays
 * green for it, because each message on its own is still fine.
 */
const DISTINCT_LABEL_SETS = ["artifactActions", "panes"] as const;

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
  "overview.loadDemo.failed",
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
  // The same two counts when they are not known (no completed visibility run,
  // no knowledge base). A plural cannot carry "—": `#` prints nothing for a
  // non-number, so the unknown case is its own sentence with the dash as text.
  "week.summaryRow.answerGapsUnknown | value",
  "week.summaryRow.kbGapsUnknown | value",
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
  "dataSources.table.ctr",
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
  // The ui primitives' own labels (Task 1b). They belong to no single view:
  // `ArtifactActionLabels` and the `tag` of `InPane`/`OutPane` are required
  // props, so every view that mounts one reads these same eleven. Spelling is the
  // component's (`exportFile`, not `export`) so a view can hand the object over
  // field for field. Not reusing `shell.drawer.*` or `week.report.*` is the
  // point: those are the drawer's and the weekly report's own words and must
  // stay free to change without dragging every artifact footer with them.
  "artifactActions.copy",
  "artifactActions.copied",
  "artifactActions.copyFailed",
  "artifactActions.copyForAi",
  "artifactActions.exportFile",
  "artifactActions.save",
  "artifactActions.saved",
  "artifactActions.tooLarge",
  "artifactActions.basketFull",
  "panes.in",
  "panes.out",
];

type Values = Readonly<Record<string, string | number>>;

interface MessageCase {
  readonly key: string;
  readonly values: Values;
  /**
   * Every values object the key must format under. Numeric arguments get a
   * second pass at 1, so an ICU plural whose `one` branch is broken or has
   * lost the disclosure cannot hide behind the `other` branch.
   */
  readonly variants: readonly Values[];
}

function parseCase(spec: string): MessageCase {
  const [rawKey = "", rawArgs = ""] = spec.split("|");
  const names = rawArgs.trim().split(/\s+/u).filter(Boolean);
  const values = names.reduce<Values>(
    (acc, name, index) =>
      name.startsWith("#")
        ? { ...acc, [name.slice(1)]: numberSentinel(index) }
        : { ...acc, [name]: textSentinel(name) },
    {},
  );
  const singular = Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      typeof value === "number" ? 1 : value,
    ]),
  );
  return {
    key: rawKey.trim(),
    values,
    variants: names.some((name) => name.startsWith("#"))
      ? [values, singular]
      : [values],
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
    for (const { key, variants } of PARSED) {
      for (const values of variants) {
        const text = formatStrict(locale, key, values);
        expect(text.trim(), key).not.toBe("");
        expect(text, key).not.toBe(key);
        expect(text, key).not.toBe(`workbench.${key}`);
        expect(text, key).not.toMatch(BRACE_RESIDUE);
        for (const value of Object.values(values)) {
          if (value === 1) continue; // too weak to assert containment on
          expect(text, `${key} must insert ${String(value)}`).toContain(
            String(value),
          );
        }
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

  it("keeps the per-key rules a required substring cannot express", () => {
    for (const [key, byLocale] of Object.entries(FORBIDDEN_BY_KEY)) {
      const listed = PARSED.find((entry) => entry.key === key);
      expect(listed, `${key} must also be listed in CASES`).toBeDefined();
      for (const values of listed?.variants ?? []) {
        const text = formatStrict(locale, key, values).toLowerCase();
        for (const phrase of byLocale[locale]) {
          expect(text, `${key} must not say "${phrase}"`).not.toContain(
            phrase.toLowerCase(),
          );
        }
      }
    }
  });

  it("spells every co-rendered primitive label differently", () => {
    for (const subtree of DISTINCT_LABEL_SETS) {
      const seen = new Map<string, string>();
      for (const key of leafPaths(node(locale, subtree), subtree)) {
        const text = rawMessage(locale, key);
        const twin = seen.get(text);
        expect(twin, `${key} reads exactly like ${twin ?? ""}: "${text}"`).toBe(
          undefined,
        );
        seen.set(text, key);
      }
    }
  });

  it("holds the artifact-action messages to exactly the component's label fields", () => {
    // The component side of this binding is `satisfies` in ArtifactActions.tsx;
    // this is the catalogue side. `OWNED_SUBTREES` cannot stand in for it: it
    // compares the catalogue with `CASES`, both of which list what the catalogue
    // HAS, so a label the row reads with no message behind it passes there.
    const subtree = node(locale, "artifactActions");
    if (subtree === null || typeof subtree !== "object") {
      throw new Error(`${locale}: workbench.artifactActions is not a subtree`);
    }
    const fields = Object.keys(ARTIFACT_ACTION_LABEL_KEYS);
    expect(Object.keys(subtree).sort()).toEqual([...fields].sort());
    for (const field of fields) {
      expect(rawMessage(locale, `artifactActions.${field}`).trim(), field).not.toBe("");
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
      const listed = PARSED.find((entry) => entry.key === key);
      expect(listed, `${key} must also be listed in CASES`).toBeDefined();
      for (const values of listed?.variants ?? []) {
        const text = formatStrict(locale, key, values);
        for (const phrase of byLocale[locale]) {
          expect(text, `${key} must still say "${phrase}"`).toContain(phrase);
        }
      }
    }
  });
});

describe("workbench view message arguments", () => {
  it("hands every multi-argument key to the consuming view to pin", () => {
    const multiArg = PARSED.filter(
      (entry) => Object.keys(entry.values).length > 1,
    ).map((entry) => entry.key);
    expect([...multiArg].sort()).toEqual([...SWAP_PRONE_KEYS].sort());
  });
});

describe("workbench view messages (en)", () => {
  it("reads as English, with no Chinese left in the catalogue", () => {
    for (const { key } of PARSED) {
      expect(HAN.test(rawMessage("en", key)), `en ${key}`).toBe(false);
    }
  });
});
