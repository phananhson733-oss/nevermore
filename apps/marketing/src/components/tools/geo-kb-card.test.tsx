// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import en from "../../i18n/messages/en.json";
import zh from "../../i18n/messages/zh.json";
import { GeoKbCard, type GeoKbCardProps, type GeoKbPublishedSummary } from "./geo-kb-card.tsx";

let host: HTMLDivElement, root: Root;
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

const card = (locale: string) => (locale === "zh" ? zh : en).tools.geoKnowledgeBase.card;
const fill = (template: string, values: Record<string, string>) =>
  Object.entries(values).reduce((text, [key, value]) => text.replaceAll(`{${key}}`, value), template);

async function render(overrides: Partial<GeoKbCardProps> = {}, locale = "en") {
  const props: GeoKbCardProps = {
    host: "astrologywiki.com",
    locale,
    state: "published",
    statusText: "Published kb@v3",
    onUpdate: vi.fn(),
    ...overrides,
  };
  await act(async () => root.render(
    <NextIntlClientProvider locale={locale} timeZone="UTC" messages={locale === "zh" ? zh : en}>
      <GeoKbCard {...props} />
    </NextIntlClientProvider>,
  ));
}

const sections = {
  identity: <span data-slot="identity">identity modules</span>,
  facts: <span data-slot="facts">fact modules</span>,
  trust: <span data-slot="trust">trust modules</span>,
  reachability: <span data-slot="reachability">reachability modules</span>,
  measurement: <span data-slot="measurement">the question set</span>,
  measurementCount: 23,
};

/**
 * Written out rather than filled from the catalog. What these pin is an ICU
 * plural, and a helper that re-implemented the rule would only ever agree with
 * itself; a literal disagrees the moment the catalog loses its plural.
 */
const MEASUREMENT_LINE: Readonly<Record<string, { readonly one: string; readonly many: string }>> = {
  en: {
    one: "Question set · 1 question · used by the AI visibility check",
    many: "Question set · 23 questions · used by the AI visibility check",
  },
  zh: {
    one: "提问集 · 1 条 · 用于 AI 可见性体检",
    many: "提问集 · 23 条 · 用于 AI 可见性体检",
  },
};

const plan = {
  nextVersion: "4",
  previousVersion: "3",
  changeCount: 6,
  itemCount: 30,
  pendingCount: 4,
  onPublish: vi.fn(),
};

it.each(["en", "zh"])("puts the website, one live status line and the billed action first in %s", async (locale) => {
  await render({ statusText: "Published" }, locale);

  expect(host.textContent).toContain("astrologywiki.com");
  const status = host.querySelector("[data-kb-state]");
  expect(status?.getAttribute("data-kb-state")).toBe("published");
  expect(status?.getAttribute("aria-live")).toBe("polite");
  expect(host.querySelector("[data-generate-kb]")?.textContent).toBe(card(locale).actions.update);
  // Presence and placement only -- what the sentence SAYS is pinned below,
  // because comparing it with the leaf it was rendered from would pass for any
  // wording at all, the opposite claim included.
  expect(host.querySelector("[data-kb-cost]")).not.toBeNull();
});

/**
 * The price of an update, written out rather than filled from the catalog.
 *
 * Same reason as the measurement lines above, but the stakes are the owner's
 * money: an assertion built from the leaf the component just rendered is
 * satisfied by every possible wording. The sentence that shipped before this
 * test existed said an update "crawls your website and off-site sources, reads
 * Search Console and makes two or three billed model calls", and all three of
 * those are false of this deployment:
 *
 *  - `planGeoRunCollection` (`kb-run-collect.ts`) emits `own` and `competitor`
 *    scopes only, one page each, and `kb-v3-assemble-handler.ts` hands the
 *    assembler `offsite: null` because nothing collects third-party evidence;
 *  - `gsc` is a member of `GEO_RUN_OPERATION_KINDS` with no producer and no
 *    executor -- nothing seeds one, and `createGeoRunUpdateExecutor`
 *    (`kb-run-runtime.ts`) routes every kind but `fetch` and `model` to
 *    `GEO_RUN_UNSUPPORTED_EXECUTOR`;
 *  - `GEO_RUN_KNOWLEDGE_MODEL_SEED` is the only model seed a run carries, and
 *    a generation records `attemptedCalls: 0 | 1`.
 *
 * The once-a-day clause is `GEO_EVIDENCE_OBSERVATION_TTL_MS` in
 * `kb-evidence-observations.ts` (24 h for `own_page` and `competitor_page`):
 * inside it, `kb-run-collect-executor.ts` answers the operation from the
 * stored observation and no request leaves the process, so a sentence
 * promising a fresh read on every press would be its own small lie. That
 * constant is NOT imported here -- the module reaches for the admin Supabase
 * client at import time -- so if the TTL moves, this sentence has to be moved
 * by hand. The repo already discloses a reuse window this way; see
 * `tools.onPageChecker.faq` on reusing a site collection within the hour.
 *
 * The wording before this one described the WARM path and nothing else. It
 * promised nine requests at five confirmed competitors -- one own page, five
 * competitor pages, three machine files -- where the cold path makes
 * twenty-one.
 * `creditGeoKnowledgeObservation` (wired in `kb-v2-runtime.ts`) can credit
 * exactly two shapes of address -- the site's own home page and
 * `https://<key>/` per confirmed competitor -- and when it credits the home
 * page the collector has no parsed body to take links from, so the update
 * really does read one page per site plus the three machine files. Measured
 * with a counting reader, that is three requests.
 *
 * On the COLD path it is fifteen with two competitors and twenty-one with
 * five. `kb-knowledge-evidence.ts` fetches the home page, follows one link per
 * intent out of it (`about`, `pricing`, `product`, `integrations`, `docs`,
 * `faq`, `changelog`, so seven at most, capped by
 * `GEO_KNOWLEDGE_EVIDENCE_LIMITS.ownPages` = 8), and reads a home page plus one
 * pricing-or-product page per competitor
 * (`competitorPagesPerIdentity` = 2, `competitors` = 5). The cold path is
 * reached two ordinary ways: a resumed run whose observation has outlived its
 * day, and a website lookup that does not answer, which credits nothing at all
 * (`kb-v2-runtime.ts` `creditObservedTargets`).
 *
 * The sentence was bounded rather than the crawl. Cutting the crawl to match
 * the old wording would take the cold path from eighteen pages to six with
 * five competitors, and those pages -- `/about`, `/pricing`, `/product`,
 * `/integrations`, `/docs`, `/faq`, `/changelog` -- are the whole input to
 * sections A, B and D of this very card. Nothing forces the cut: the extra
 * reads add no billed model call, and no extra crawl-gate allowance either,
 * because `createGeoKnowledgeResourceReader` memoises one admission per
 * canonical gate key (`kb-enrichment-deps.ts`). The damage was a coverage
 * claim, so the coverage is what the sentence now states.
 *
 * `COST_NAMES` and `COST_REQUIRED` below are the half of that promise this
 * file can check, and they are checked against the RENDERED text rather than
 * against `COST_LINE`, so pasting a new catalog string into `COST_LINE` does
 * not make a dropped clause pass. The other half is checked against behaviour
 * rather than wording, in `lib/geo-tools/kb-v2-runtime.test.ts`: it drives the
 * real collector through the real runtime adapter over a home page that
 * actually carries links, counts what leaves the process on the cold path, and
 * requires this sentence to name that count in words. Widening the crawl there
 * and leaving this sentence alone turns that test red. "Widening" means moving
 * `INTENTS` and `ownPages` together: the own-site figure is
 * `min(1 + INTENTS.length, ownPages)`, so either constant moved alone leaves
 * eight the true answer and this sentence true.
 */
const COST_LINE: Readonly<Record<string, string>> = {
  en: "One update reads your site's robots.txt, sitemap.xml and llms.txt every time. Beyond those it reads your home page and the home page of each confirmed competitor site (up to five sites), unless a reading less than a day old can be reused — a second update on the same day re-reads only the three files. When no reading can be reused it crawls instead: up to eight pages of your website (the home page and up to seven pages linked from it) and up to two pages of each confirmed competitor site. Then it makes one billed model call. The draft it produces is yours to publish.",
  zh: "每次更新都会读取你网站的 robots.txt、sitemap.xml 和 llms.txt。除此之外会读取你的首页，以及每个已确认竞品站点的首页（最多五个站点）；如果有一天以内的读取结果可以复用就不再读——同一天内的第二次更新只会重新读那三个文件。一条读取结果都用不上时才会改为抓取：你网站最多八个页面（首页，以及首页链接到的最多七个页面），每个已确认竞品站点最多两个页面。然后发起一次模型调用（计费）。更新出的草稿由你决定何时发布。",
};

/**
 * The reading an update still does that no ledger row names, disclosed by name.
 *
 * "competitor site" rather than "competitor" is load-bearing too: two confirmed
 * competitors that differ only by `www.` are one site to the crawl gate, which
 * budgets against the apex host, so the update plans one page for the pair.
 *
 * Checked separately from `COST_LINE` for the reason that whole block exists:
 * the obvious way to "fix" a failure above is to paste in whatever the catalog
 * now says, and doing that with any of these three dropped still turns this
 * red.
 */
const COST_NAMES: readonly string[] = ["robots.txt", "sitemap.xml", "llms.txt"];

/**
 * The three claims this deployment cannot support, checked against the
 * RENDERED text rather than against `COST_LINE`.
 *
 * This is the layer that survives the obvious way of "fixing" a failure here:
 * pasting whatever the catalog now says into `COST_LINE`. Doing that with any
 * of these back in the sentence still turns this test red.
 */
const COST_FORBIDDEN: Readonly<Record<string, readonly RegExp[]>> = {
  // The model-call patterns name a COUNT next to the call, rather than
  // forbidding digits outright: an honest future sentence may well need a
  // number ("up to five competitor pages"), and a blanket digit ban would
  // push the next author into vaguer copy instead of truer copy.
  // The last pattern in each row is the sentence this deployment measured as
  // false and carried anyway: a credited home page is not re-read, and neither
  // are the pages that would have been followed out of it.
  en: [/search console/iu, /off-?site/iu, /(?:\btwo\b|\bthree\b|[2-9])[^.]*model call/iu, /every other page is read again/iu],
  zh: [/search console/iu, /站外/u, /(?:两|三|[2-9])[^。]*模型调用/u, /其余页面每次更新都会重新读取/u],
};

/**
 * The five claims that make the sentence a disclosure rather than an
 * advertisement, each checked against the RENDERED text.
 *
 * Every one of these is a bound on reading the owner never asked for and
 * cannot see happen, and every one of them could be deleted with the rest of
 * the suite green: `COST_LINE` above pins the whole string, so the obvious way
 * to "fix" a failure there is to paste in whatever the catalog now says, and
 * that move silently accepts a sentence with any clause missing. These are the
 * layer that move does not survive.
 *
 * The three counts are stated in words rather than digits so that
 * `COST_FORBIDDEN`'s "N model calls" pattern stays a check on the model call
 * and not an accidental ban on describing the crawl.
 */
const COST_REQUIRED: Readonly<Record<string, readonly RegExp[]>> = {
  en: [
    // The own-site budget, and the fact that most of it is followed links.
    /up to eight pages of your website/iu,
    /up to seven pages linked from it/iu,
    // Two per competitor site, not one: the collector reads a home page and
    // then one pricing-or-product page off it.
    /up to two pages of each confirmed competitor site/iu,
    /up to five sites/iu,
    // The reuse claim, and the consequence that makes it worth stating.
    // A credited home page leaves no parsed body, so `kb-knowledge-evidence.ts`
    // never runs its link loop and never reaches the competitors' second pages
    // either: the warm update is the three machine files and nothing else.
    // The pair this replaces asserted the opposite ("every other page is read
    // again on each update"), and being REQUIRED is what kept the false clause
    // in the catalogue -- any true rewrite failed here.
    /a reading less than a day old/iu,
    /re-?reads only the three files/iu,
    /one billed model call/iu,
  ],
  zh: [
    /最多八个页面/u,
    /首页链接到的最多七个页面/u,
    /每个已确认竞品站点最多两个页面/u,
    /最多五个站点/u,
    /一天以内的读取结果可以复用/u,
    /只会重新读那三个文件/u,
    /模型调用（计费）/u,
  ],
};

/**
 * Folded behind one line since 2026-09-11. The line that stays visible has to
 * say the two things an owner must know before a button with no confirmation
 * step: it reads the site, and it bills a model call. The paragraph opens on
 * one press and is the exact text the runtime test holds against the
 * collector; folded is the resting state, so the default render must not
 * carry it.
 */
it.each(["en", "zh"])("says what one update actually does and costs, in %s", async (locale) => {
  await render({}, locale);

  const summary = host.querySelector("[data-kb-cost-summary]")?.textContent ?? "";
  expect(summary).toBe(card(locale).costSummary);
  expect(summary).toMatch(locale === "zh" ? /计费/u : /billed/iu);
  expect(summary).toMatch(locale === "zh" ? /模型调用/u : /model call/iu);
  expect(host.querySelector("[data-kb-cost-detail]")).toBeNull();

  const toggle = host.querySelector<HTMLButtonElement>("[data-kb-cost-toggle]")!;
  expect(toggle.getAttribute("aria-expanded")).toBe("false");
  await act(async () => toggle.click());
  expect(toggle.getAttribute("aria-expanded")).toBe("true");
  const note = host.querySelector("[data-kb-cost-detail]")?.textContent;
  expect(note).toBe(COST_LINE[locale]);
  for (const claim of COST_FORBIDDEN[locale]!) expect(note).not.toMatch(claim);
  for (const named of COST_NAMES) expect(note).toContain(named);
  // Reported as the list of what is missing rather than one assertion per
  // pattern: a sentence that lost three clauses should say so in one failure.
  expect(COST_REQUIRED[locale]!.filter((claim) => !claim.test(note ?? "")).map(String)).toEqual([]);
});

/**
 * A caller with its own sentence replaces this one entirely. The v2 card does
 * exactly that, which is why the sentence above is a statement about a v3
 * update and not about every card on the site.
 */
it("lets a caller replace the billing sentence with its own", async () => {
  await render({ costNote: <span data-own-cost="">this run is free</span> });

  expect(host.querySelector("[data-own-cost]")).not.toBeNull();
  expect(host.querySelector("[data-kb-cost]")).toBeNull();
  expect(host.textContent).not.toContain(COST_LINE.en);
});

it("uses the caller's update label and disabled state when it has one", async () => {
  const onUpdate = vi.fn();
  await render({ updateLabel: "Generate again", updateDisabled: true, onUpdate });

  const button = host.querySelector<HTMLButtonElement>("[data-generate-kb]");
  expect(button?.textContent).toBe("Generate again");
  expect(button?.disabled).toBe(true);
  await act(async () => button!.click());
  expect(onUpdate).not.toHaveBeenCalled();
});

it("offers no publish action while there is nothing to publish", async () => {
  await render();
  expect(host.querySelector("[data-publish-kb]")).toBeNull();
  expect(host.querySelector("[data-kb-publish-box]")).toBeNull();
});

it.each(["en", "zh"])("says what publishing would change and what is still unconfirmed in %s", async (locale) => {
  const onPublish = vi.fn();
  await render({ publish: { ...plan, onPublish } }, locale);

  expect(host.querySelector('[data-publish-kb="header"]')?.textContent).toBe(fill(card(locale).actions.publish, { version: "4" }));
  expect(host.querySelector("[data-kb-publish-changes]")?.textContent).toBe(fill(card(locale).publish.changes, { count: "6", version: "3" }));
  expect(host.querySelector("[data-kb-publish-pending]")?.textContent).toBe(fill(card(locale).publish.pending, { count: "4" }));
  expect(host.textContent).toContain(card(locale).publishFree);

  await act(async () => host.querySelector<HTMLElement>('[data-publish-kb="box"]')!.click());
  expect(onPublish).toHaveBeenCalledTimes(1);
});

/**
 * A v1/v2 predecessor records no per-item decisions, so there is no count to
 * give. Null is not zero here, and it is not "everything changed" either: the
 * box names the version and says the comparison cannot be made.
 */
it.each(["en", "zh"])("says a previous version cannot be compared item by item, in %s", async (locale) => {
  await render({ publish: { ...plan, changeCount: null } }, locale);

  const said = host.querySelector("[data-kb-publish-changes]")?.textContent;
  expect(said).toBe(fill(card(locale).publish.changesUncountable, { count: "30", version: "3" }));
  // Never the countable sentence, and never a number standing in for the count.
  expect(said).not.toBe(fill(card(locale).publish.changes, { count: "0", version: "3" }));
  expect(said).not.toBe(fill(card(locale).publish.changes, { count: "6", version: "3" }));
  expect(said).not.toContain("[missing copy:");
});

it("counts a first version instead of comparing it with one that does not exist", async () => {
  await render({ publish: { ...plan, previousVersion: null, pendingCount: 0 } });

  expect(host.querySelector("[data-kb-publish-changes]")?.textContent).toBe(fill(card("en").publish.firstVersion, { count: "30" }));
  // Nothing pending renders no line at all: a sentence saying there is no
  // problem is one more thing to read on the screen that always has none.
  expect(host.querySelector("[data-kb-publish-pending]")).toBeNull();
});

it.each(["en", "zh"])("groups the modules into the five lettered sections in %s", async (locale) => {
  await render({ sections }, locale);

  expect(Array.from(host.querySelectorAll("[data-kb-section]")).map((node) => node.getAttribute("data-kb-section")))
    .toEqual(["identity", "facts", "trust", "reachability", "measurement"]);
  for (const name of ["identity", "facts", "trust", "reachability"] as const) {
    expect(host.querySelector(`[data-slot="${name}"]`), name).not.toBeNull();
    expect(host.textContent).toContain(card(locale).sections[name].items);
  }
});

it.each(["en", "zh"])("keeps measurement folded away until it is asked for, in %s", async (locale) => {
  await render({ sections }, locale);

  const toggle = host.querySelector<HTMLButtonElement>("[data-kb-measurement-toggle]");
  expect(host.querySelector('[data-kb-measurement-items="count"]')?.textContent).toBe(MEASUREMENT_LINE[locale]!.many);
  expect(toggle?.getAttribute("aria-expanded")).toBe("false");
  expect(host.querySelector('[data-slot="measurement"]')).toBeNull();

  await act(async () => toggle!.click());

  expect(host.querySelector("[data-kb-measurement-toggle]")?.getAttribute("aria-expanded")).toBe("true");
  expect(host.querySelector('[data-slot="measurement"]')).not.toBeNull();
  expect(host.querySelector("[data-kb-measurement-toggle]")?.textContent).toContain(card(locale).sections.measurement.hide);
});

it.each(["en", "zh"])("says one question in the singular, in %s", async (locale) => {
  await render({ sections: { ...sections, measurementCount: 1 } }, locale);
  expect(host.querySelector('[data-kb-measurement-items="count"]')?.textContent).toBe(MEASUREMENT_LINE[locale]!.one);
});

/**
 * The line an owner reads when a draft carries no question set, written out
 * here rather than filled from the catalog.
 *
 * `expect(rendered).toBe(card(locale).sections.measurement.itemsUnavailable)`
 * is the assertion this replaces, and it was worth nothing: it compares the
 * rendered string with the very leaf the component rendered it from, so it
 * stays green for ANY wording, including the opposite claim. What it did prove
 * -- that the component reaches this leaf and not another -- is kept by the
 * `data-kb-measurement-items="unavailable"` selector below.
 */
const NO_QUESTION_SET_LINE: Readonly<Record<string, string>> = {
  en: "Question set · none on this draft · this update does not build one, so the AI visibility check cannot run against the version you publish",
  zh: "提问集 · 这份草稿没有 · 本次更新不会生成提问集，因此 AI 可见性体检无法针对你发布的版本运行",
};

/**
 * The promise the previous wording made, which points at a surface that cannot
 * exist in this deployment.
 *
 * It said a question set "belongs to a published version, and the AI
 * visibility check reads it from there". Nothing here produces a v3 question
 * set: `planGeoRunCollection` seeds `fetch` operations and
 * `GEO_RUN_KNOWLEDGE_MODEL_SEED` and no `questions` step, so
 * `kb-v3-draft-create.ts` writes `runRef.questionsGenerationId: null` and
 * nothing ever moves it; `resolveQuestionSet` (`kb-v3-publish-handler.ts`)
 * therefore answers `unavailable / not_attempted` on every v3 publish, every
 * published v3 version carries `questionSet === null`, and
 * `visibility-handler-deps.ts` drops exactly those versions from the list the
 * AI visibility check offers. There is no "there" to read it from. Checked
 * against the RENDERED text for the same reason as `COST_FORBIDDEN`: pasting a
 * new catalog string into `NO_QUESTION_SET_LINE` does not make the promise
 * pass.
 *
 * `review.publishNoQuestionSet` is the tone to match -- it fires on every v3
 * publish and says the check cannot run against that version.
 *
 * This sentence is true only while nothing builds a v3 question set. Seed a
 * `questions` step in `kb-run-collect.ts` and it stops being true twice over:
 * an update would build one, and a version that failed to would need
 * `generation_unavailable` and `outcome_unknown` said as themselves rather
 * than as "this update does not build one". `resolveQuestionSet` already
 * distinguishes those three; this card is handed only `number | null` and
 * cannot, so widening it is a change to `GeoKbCardProps` and not to this
 * string alone.
 */
const NO_QUESTION_SET_FORBIDDEN: Readonly<Record<string, readonly RegExp[]>> = {
  en: [/belongs to a published version/iu, /reads? it from there/iu],
  zh: [/属于已发布的版本/u, /从那里读取/u],
};

/** And it has to say what the owner loses, not merely that a field is empty. */
const NO_QUESTION_SET_REQUIRED: Readonly<Record<string, readonly RegExp[]>> = {
  en: [/AI visibility check cannot run/iu],
  zh: [/AI 可见性体检无法/u],
};

/**
 * The count is the number of questions in a set that exists. A draft has no
 * set at all, and rendering that as `0` states the strongest possible version
 * of the wrong thing: not "we could not read it" but "it is there and it is
 * empty", which sends the owner looking for whatever emptied it.
 */
it.each(["en", "zh"])("says a missing question set is missing rather than empty, in %s", async (locale) => {
  await render({ sections: { ...sections, measurementCount: null } }, locale);

  const line = host.querySelector('[data-kb-measurement-items="unavailable"]')?.textContent;
  expect(line).toBe(NO_QUESTION_SET_LINE[locale]);
  for (const claim of NO_QUESTION_SET_FORBIDDEN[locale]!) expect(line).not.toMatch(claim);
  expect(NO_QUESTION_SET_REQUIRED[locale]!.filter((claim) => !claim.test(line ?? "")).map(String)).toEqual([]);
  // No count of any kind: not 0, not the one the count line would have shown.
  expect(line).not.toMatch(/\d/u);
  expect(host.querySelector('[data-kb-measurement-items="count"]')).toBeNull();
  // The section is still there and still collapses: an absent count is not an
  // absent section.
  expect(host.querySelector("[data-kb-measurement-toggle]")).not.toBeNull();
  // next-intl renders a missing key as its path, which would read the same in
  // both locales.
  expect(card("zh").sections.measurement.itemsUnavailable).not.toBe(card("en").sections.measurement.itemsUnavailable);
});

it.each(["en", "zh"])("stands still as a published summary once there is a version, in %s", async (locale) => {
  const onEdit = vi.fn(), onView = vi.fn();
  await render({
    collapsed: true,
    sections,
    publish: plan,
    summary: {
      version: "4",
      name: "AstrologyWiki",
      host: "astrologywiki.com",
      publishedAt: "2026-09-07T00:00:00.000Z",
      counts: { facts: { facts: 18, accepted: 6 }, qa: { qa: 12 }, comparisons: { available: 4, comparisons: 6 } },
      onEdit,
      onView,
    },
  }, locale);

  expect(host.querySelector("[data-geo-kb-collapsed]")).not.toBeNull();
  expect(host.querySelector("[data-kb-published-version]")?.textContent).toContain(fill(card(locale).published.headline, { version: "4" }));
  expect(host.querySelector("[data-kb-published-counts]")?.textContent).toBe([
    fill(card(locale).published.counts.facts, { facts: "18", accepted: "6" }),
    fill(card(locale).published.counts.qa, { qa: "12" }),
    fill(card(locale).published.counts.comparisons, { available: "4", comparisons: "6" }),
    locale === "zh" ? "2026年9月7日" : "Sep 7, 2026",
  ].join(" · "));
  /**
   * And it counts no off-site sources. Nothing in this deployment collects
   * any, so the only number this line could ever carry is `0` -- which does
   * not read as "we never looked", it reads as "we looked and found none".
   * The line above cannot catch this on its own: it is filled from the same
   * catalog leaf the component rendered from, so it agrees with whatever the
   * leaf says.
   */
  expect(host.querySelector("[data-kb-published-counts]")?.textContent)
    .not.toMatch(locale === "zh" ? /站外/u : /off-?site/iu);
  // The collapsed card is a summary, not a second copy of the whole editor.
  expect(host.querySelector("[data-generate-kb]")).toBeNull();
  expect(host.querySelector("[data-kb-section]")).toBeNull();
  expect(host.querySelector("[data-kb-publish-box]")).toBeNull();

  await act(async () => host.querySelector<HTMLElement>("[data-kb-edit]")!.click());
  expect(onEdit).toHaveBeenCalledTimes(1);
  await act(async () => host.querySelector<HTMLElement>("[data-kb-view]")!.click());
  expect(onView).toHaveBeenCalledTimes(1);
});

/**
 * Every string this card can render, flattened, so a sweep reads all of them
 * and not just the ones a component happens to be wired to today. The
 * off-site count in `published.counts` and the "off-site sources" in
 * `status.collecting` were both invisible to a component test: nothing passes
 * a `summary` and nothing renders a `collecting` status, so the only thing
 * that could have caught them is a reader of the catalog itself.
 */
function leaves(value: unknown, prefix = ""): readonly (readonly [string, string])[] {
  if (typeof value === "string") return [[prefix, value]];
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>)
    .flatMap(([key, child]) => leaves(child, prefix === "" ? key : `${prefix}.${key}`));
}

/**
 * The three keys that may name Search Console or an off-site source, because
 * they are LABELS for where one already-collected item came from -- rendered
 * only beside an item that carries that origin -- and not statements about
 * what pressing Update does.
 *
 * Enumerated, and the count asserted, so a rename cannot quietly widen the
 * exemption to nothing or to everything.
 */
const ORIGIN_LABEL_KEYS: readonly string[] = [
  "origins.observed_gsc",
  "origins.observed_third_party",
  "originDetail.thirdParty",
];

/**
 * The two limitation clauses that name off-site work, exempt on the same
 * grounds as the origin labels above: each is rendered only when a stored
 * payload's `limitationKeys` carries that clause, which requires an off-site
 * collection to have happened and reported an incomplete stage. A v3 update
 * hands the assembler `offsite: null`, so neither can be produced today -- and
 * neither says anything about what pressing Update does.
 *
 * Enumerated and counted, like the list above, so a rename cannot widen the
 * exemption. If a leaf outside these five ever names off-site collection, it is
 * a claim about the product and this test is right to fail.
 */
const OFFSITE_CLAUSE_KEYS: readonly string[] = [
  "limitations.clause.offsite_pages_unread",
  "limitations.clause.offsite_stage_stopped",
];

/**
 * Neither claim is true of what a v3 update does.
 *
 * `gsc` has no producer and no executor (`kb-run-runtime.ts` routes every kind
 * but `fetch` and `model` to `GEO_RUN_UNSUPPORTED_EXECUTOR`), and off-site
 * evidence is never collected -- `planGeoRunCollection` emits `own` and
 * `competitor` scopes only and the assembler is handed `offsite: null`. Three
 * separate leaves in this catalog said otherwise at once, in both languages,
 * and the two that no component renders today would have become live lies the
 * moment somebody wired them.
 */
it.each(["en", "zh"])("claims no Search Console read and no off-site collection anywhere in the card catalog, in %s", (locale) => {
  const all = leaves(card(locale));
  const exemptKeys = [...ORIGIN_LABEL_KEYS, ...OFFSITE_CLAUSE_KEYS];
  const exempt = all.filter(([key]) => exemptKeys.includes(key));
  expect(exempt).toHaveLength(exemptKeys.length);

  const claims = all
    .filter(([key]) => !exemptKeys.includes(key))
    .filter(([, message]) => /search console|off-?site/iu.test(message) || /站外/u.test(message));

  expect(claims).toEqual([]);
});

/**
 * The four claims that make the Rebuild button pressable, pinned by CONTENT.
 *
 * `card.recovery.rebuildNote` is rendered by `geo-kb-v3-review.tsx` beside a
 * button that throws away an assembled draft, and until now no test anywhere
 * read a word of it: the whole leaf could be replaced with the empty string,
 * or with "rebuilding is safe and changes nothing", and every suite in this
 * repo stayed green. It is read here, from the catalog, for the same reason
 * the sweep below reads the catalog rather than a rendered card -- a sentence
 * this component does not render is still a sentence this catalog ships.
 *
 * By clause rather than by whole string, so a rewording that keeps all four
 * claims passes and only a rewording that drops one fails.
 *
 * Each is checked against the code that makes it true:
 *  - the discard and the re-charge are `relockGeoKbV3Payload`'s `discarded`
 *    and the fresh `runRef` it mints (`kb-v3-draft-create.ts`);
 *  - "nothing is written and nothing is discarded" is the
 *    `geoProfileRefNamesConfirmed` branch above it, which returns
 *    `relocked: false` before building or saving anything;
 *  - "makes no model call and reads no page" is provable from
 *    `GeoKbV3DraftCreateDependencies` (`kb-v3-runtime.ts`): the draft route's
 *    dependencies are auth, two reads, a save, a running-check and a quota.
 *    There is no reader and no LLM client to call. Note that the route file's
 *    own `maxDuration` comment still describes "the collection this step
 *    performs"; the dependency list is what settles it, and the runtime says
 *    in as many words that this route no longer crawls. If a collector is ever
 *    injected there, this is the assertion that has to be faced before the
 *    sentence can stay.
 */
const REBUILD_NOTE_REQUIRED: Readonly<Record<string, readonly RegExp[]>> = {
  en: [
    /discards the knowledge it holds/iu,
    /pays for that knowledge again/iu,
    /nothing is written and nothing is discarded/iu,
    // Split in two: "no model call" and "no page read" are separate promises
    // about separate spending, and one can be dropped without the other.
    /makes no model call/iu,
    /reads no page/iu,
  ],
  zh: [/丢弃它持有的知识/u, /重新计费/u, /什么都不会写入/u, /不调用模型/u, /不抓取任何页面/u],
};

it.each(["en", "zh"])("says what rebuilding destroys, what it costs next time, and what it does not spend, in %s", (locale) => {
  const note = card(locale).recovery.rebuildNote;
  expect(REBUILD_NOTE_REQUIRED[locale]!.filter((claim) => !claim.test(note)).map(String)).toEqual([]);
});

it("keeps its own data attributes and adds no disclosure widget", async () => {
  await render({ sections, publish: plan, ["data-geo-kb-v2"]: true } as Partial<GeoKbCardProps>);

  expect(host.querySelector("[data-geo-kb-v2]")).not.toBeNull();
  expect(host.querySelector("[data-geo-kb-card]")).not.toBeNull();
  expect(host.querySelector("details")).toBeNull();
});

/**
 * The counts the published summary can supply, and the whole of them.
 *
 * `GeoKbCopy.published.counts` no longer declares a `thirdParty` argument, and
 * this card holds no off-site count to feed one. Nothing in this deployment
 * collects off-site evidence, so the only number either could ever carry is
 * `0`, and `0` there reads as "we looked and found none" rather than "we never
 * looked". The clause split in `geo-kb-copy.ts` closed that argument; what this
 * file closes are the two routes a count would still have to travel to reach a
 * screen, so neither can be opened on its own:
 *
 *   - a field added to `GeoKbPublishedSummary["counts"]` fails the exhaustive
 *     check below at typecheck time, where `satisfies` would not have -- a
 *     wider object still satisfies a narrower constraint;
 *   - a placeholder added to the message fails the test below.
 *
 * Adding a genuine new count therefore has to touch both, which is the point:
 * the line may only name numbers this card holds.
 */
const SUMMARY_COUNT_FIELDS = ["facts", "accepted", "qa", "available", "comparisons"] as const;
/** The clause keys, which are also the modules the summary may mention at all. */
const SUMMARY_COUNT_CLAUSES = ["facts", "qa", "comparisons"] as const;
type SummaryCountClause = keyof GeoKbPublishedSummary["counts"];
type ClausesAreExhaustive = SummaryCountClause extends (typeof SUMMARY_COUNT_CLAUSES)[number] ? true : never;
/** Its assertion is the annotation: a new clause makes this `never` and tsc red. */
const COUNT_CLAUSES_ARE_EXHAUSTIVE: ClausesAreExhaustive = true;
type SummaryCountField = keyof NonNullable<GeoKbPublishedSummary["counts"]["facts"]>
  | keyof NonNullable<GeoKbPublishedSummary["counts"]["qa"]>
  | keyof NonNullable<GeoKbPublishedSummary["counts"]["comparisons"]>;
type CountFieldsAreExhaustive = SummaryCountField extends (typeof SUMMARY_COUNT_FIELDS)[number] ? true : never;
const COUNT_FIELDS_ARE_EXHAUSTIVE: CountFieldsAreExhaustive = true;

it.each(["en", "zh"])("asks the published summary line for no count this card cannot supply, in %s", (locale) => {
  expect(COUNT_FIELDS_ARE_EXHAUSTIVE).toBe(true);
  expect(COUNT_CLAUSES_ARE_EXHAUSTIVE).toBe(true);
  // The date is written by the component, not by any clause: a clause that
  // asked for it would print it once per module.
  expect(Object.keys(card(locale).published.counts).toSorted()).toEqual([...SUMMARY_COUNT_CLAUSES].toSorted());

  const placeholders = SUMMARY_COUNT_CLAUSES
    .flatMap((clause) => [...card(locale).published.counts[clause].matchAll(/\{([A-Za-z][A-Za-z0-9_]*)/gu)])
    .map(([, name]) => name)
    .toSorted();

  expect(placeholders).toEqual([...SUMMARY_COUNT_FIELDS].toSorted());
});
