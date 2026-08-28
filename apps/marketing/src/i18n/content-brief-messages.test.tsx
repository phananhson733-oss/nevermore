// @vitest-environment jsdom
// @input  -- real EN/ZH catalogs, one contract-valid brief fixture, and the brief result components
// @output -- proof the front-end-verifiable items of handoff §8 render the promised copy in both locales
// @pos    -- integration guard against shipping literal next-intl key paths or an "unavailable"
//            rendered as a zero

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ContentBrief } from "@sf/public-tools/content-brief/contract";
import {
  CRAWL_MIN_FOR_LENGTH,
  FORMAT_PLURALITY_MIN,
  MUST_ANSWER_CAP,
} from "@sf/public-tools/content-brief/constants";

import { ContentBriefResults } from "../components/tools/content-brief-results";
import {
  validContentBrief,
  withFingerprint,
  withRun,
} from "../components/tools/content-brief-fixture";
import enMessages from "./messages/en.json";
import zhMessages from "./messages/zh.json";

let root: Root | null = null;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
});

async function render(
  locale: "en" | "zh",
  brief: ContentBrief,
): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  const messages = locale === "en" ? enMessages : zhMessages;
  await act(async () => {
    root?.render(
      <NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC">
        <ContentBriefResults brief={brief} locale={locale} />
      </NextIntlClientProvider>,
    );
  });
  return host;
}

function text(host: HTMLElement, selector: string): string {
  const node = host.querySelector(selector);
  expect(node, `${selector} did not render`).not.toBeNull();
  return node?.textContent ?? "";
}

const FORMAT_TIED: ContentBrief["format"] = {
  status: "available",
  values: ["guide", "listicle", "forum"],
  distribution: {
    guide: 3,
    listicle: 3,
    forum: 3,
    comparison: 1,
    product_page: 0,
    tool: 0,
    video: 0,
    news: 0,
  },
  unknown_count: 0,
  classified: 10,
  plurality_threshold: FORMAT_PLURALITY_MIN,
  has_plurality: false,
  provenance: { method: "heuristic", origin: "dataforseo_serp" },
};

const FORMAT_BELOW: ContentBrief["format"] = {
  ...FORMAT_TIED,
  values: ["guide"],
  distribution: { ...FORMAT_TIED.distribution, guide: 4 },
};

describe.each([
  {
    locale: "en" as const,
    undecidable: "cannot decide whether you would compete with your own page",
    createWord: /\bcreate\b/i,
    lengthInsufficient: `Fewer than ${CRAWL_MIN_FOR_LENGTH} fully fetched pages`,
    attempted: (count: number) => `(${count})`,
    noPlurality: "No single plurality format",
    belowThreshold: `did not reach the ${FORMAT_PLURALITY_MIN}-page threshold`,
    notChoosing: "does not choose for you",
    budget: `Candidates 14 · shown ${MUST_ANSWER_CAP} (cap ${MUST_ANSWER_CAP}) · not shown 6`,
    denominator: "Denominator 6 = competitor pages read this run (including 2 partially read)",
    insufficientEvidence:
      "This run could not read the evidence this path depends on (observed 0 / attempted 10)",
    empty: /No heading is shared by \d+ or more of the 6 pages read/,
    profileUnconfirmed: "Profile not confirmed",
    sameHost: "same-host deduplication",
    notConfigured: "Model not configured",
    unsupported: "Not supported for this language in v1",
    draftUnsupported: "Draft generation is not available for this language",
    readiness: "0 sections writable",
    modelReported: "as reported by the deployment",
    tempNotReported: "effective value not reported by the deployment",
    attemptsNotKnown: "attempts not known",
    checkedMismatch: "The model reported checking",
    derivedFromCrawl: "competitor pages",
    ledgerWord: "in the ledger",
  },
  {
    locale: "zh" as const,
    undecidable: "无法判定是否自我竞争",
    createWord: /新建/,
    lengthInsufficient: `少于 ${CRAWL_MIN_FOR_LENGTH} 篇`,
    attempted: (count: number) => `（${count} 篇）`,
    noPlurality: "没有单一多数形态",
    belowThreshold: `未过 ${FORMAT_PLURALITY_MIN} 篇门槛`,
    notChoosing: "不替你选",
    budget: `候选 14 · 展示 ${MUST_ANSWER_CAP}（上限 ${MUST_ANSWER_CAP}）· 未展示 6`,
    denominator: "分母 6 = 本次读到的竞品页（含 2 篇部分读取）",
    insufficientEvidence: "本次运行读不到这条路径所依赖的证据（observed 0 / attempted 10）",
    empty: /6 篇里没有 \d+ 篇以上共用的小标题/,
    profileUnconfirmed: "档案未确认",
    sameHost: "同站去重",
    notConfigured: "模型未配置",
    unsupported: "本语言不支持",
    draftUnsupported: "本语言 v1 不能生成 draft",
    readiness: "0 节可写",
    modelReported: "部署回报",
    tempNotReported: "部署未回报生效值",
    attemptsNotKnown: "尝试次数未知",
    checkedMismatch: "模型自报对照了",
    derivedFromCrawl: "竞品页面",
    ledgerWord: "进账本",
  },
])("content brief $locale result copy", (expected) => {
  it("§8-1: an undecidable verdict says it cannot decide and never says create", async () => {
    const host = await render(expected.locale, validContentBrief());
    const card = host.querySelector("[data-verdict-card]");
    expect(card?.getAttribute("data-verdict-action")).toBe("undecidable");
    expect(card?.getAttribute("data-verdict-reason")).toBe("no_gsc_property");
    expect(card?.textContent).toContain(expected.undecidable);
    expect(card?.textContent).not.toMatch(expected.createWord);
    // No source colour on the verdict card, and no provenance chip for the
    // no-property branch (provenance is null there by contract).
    expect(card?.querySelector("[data-source-chip]")).toBeNull();
    expect(host.textContent).not.toContain("tools.contentBrief");
    expect(host.textContent).not.toContain("verdict.undecidable");
  });

  it("§8-2: length below the floor prints the floor and the pages it counted", async () => {
    // The package fixture's default run: observed 6, truncated 2, so four
    // full pages -- one short of CRAWL_MIN_FOR_LENGTH.
    const brief = validContentBrief();
    const length = brief.length;
    if (length.status !== "unavailable" || length.attempted !== 4) throw new Error("fixture");
    const host = await render(expected.locale, brief);
    const card = text(host, '[data-field-card="length"]');
    expect(card).toContain(expected.lengthInsufficient);
    expect(card).toContain(expected.attempted(4));

    const zero = await render(
      expected.locale,
      validContentBrief({
        length: { status: "unavailable", reason: "insufficient_evidence", attempted: 0 },
      }),
    );
    expect(text(zero, '[data-field-card="length"]')).toContain(expected.attempted(0));
  });

  it("§8-3: a tie lists every format; one value below the threshold shows the distribution", async () => {
    const tied = await render(expected.locale, validContentBrief({ format: FORMAT_TIED }));
    const tiedCard = tied.querySelector('[data-field-card="format"]');
    expect(tiedCard?.querySelectorAll("[data-format-value]")).toHaveLength(3);
    expect(tiedCard?.querySelector("[data-format-body]")?.getAttribute("data-format-body")).toBe("noPlurality");
    expect(tiedCard?.textContent).toContain(expected.noPlurality);
    expect(tiedCard?.textContent).toContain(expected.notChoosing);

    const below = await render(expected.locale, validContentBrief({ format: FORMAT_BELOW }));
    const belowCard = below.querySelector('[data-field-card="format"]');
    expect(belowCard?.querySelectorAll("[data-format-value]")).toHaveLength(1);
    expect(belowCard?.querySelector("[data-format-body]")?.getAttribute("data-format-body")).toBe("belowThreshold");
    expect(belowCard?.textContent).toContain(expected.belowThreshold);
    expect(belowCard?.textContent).toContain(expected.notChoosing);
    expect(belowCard?.querySelector("[data-format-distribution]")?.textContent).toContain("4");
  });

  it("§8-4: the budget line adds up and names the denominator with its truncated count", async () => {
    const base = validContentBrief();
    const host = await render(
      expected.locale,
      validContentBrief({
        budget: {
          ...base.budget,
          must_answer_candidates: 14,
          must_answer_shown: MUST_ANSWER_CAP,
          must_answer_hidden: 14 - MUST_ANSWER_CAP,
        },
      }),
    );
    expect(text(host, "[data-budget-line]")).toContain(expected.budget);
    expect(text(host, "[data-budget-denominator]")).toContain(expected.denominator);
  });

  it("§8-5: an unreadable crawl is 'could not read the evidence', not 'no questions'", async () => {
    const failed = withRun(
      validContentBrief({
        must_answer: { status: "unavailable", reason: "insufficient_evidence", attempted: 0 },
      }),
      { reads: { crawl: { status: "partial", attempted: 10, observed: 0, truncated: 0, failed: 10, skipped: 0 } } },
    );
    const host = await render(expected.locale, failed);
    const card = text(host, "[data-must-answer]");
    expect(card).toContain(expected.insufficientEvidence);
    expect(card).not.toMatch(expected.empty);
    expect(host.querySelector('[data-coverage-cell="crawl"]')?.getAttribute("data-coverage-status")).toBe("partial");

    const empty = await render(
      expected.locale,
      validContentBrief({ must_answer: { status: "available", items: [] } }),
    );
    expect(text(empty, "[data-must-answer-empty]")).toMatch(expected.empty);
  });

  it("§8-6: no profile means no gap-angle section; an unconfirmed profile says so", async () => {
    const none = await render(expected.locale, validContentBrief());
    expect(none.querySelector("[data-gap-angle]")).toBeNull();

    const unconfirmed = withRun(
      validContentBrief({
        gap_angle: { status: "unavailable", reason: "insufficient_evidence", attempted: null },
      }),
      {
        reads: {
          product_profile: { status: "unavailable", reason: "insufficient_evidence", attempted: 1 },
        },
      },
    );
    const host = await render(expected.locale, unconfirmed);
    const card = host.querySelector("[data-gap-angle]");
    expect(card).not.toBeNull();
    expect(card?.textContent).toContain(expected.profileUnconfirmed);
    expect(card?.querySelector("[data-unavailable-reason]")?.getAttribute("data-unavailable-source")).toBe("product_profile");
  });

  it("§8-12: a same-host skip is counted and named in the coverage strip", async () => {
    const host = await render(expected.locale, validContentBrief());
    const crawl = host.querySelector('[data-coverage-cell="crawl"]');
    expect(crawl?.textContent).toContain("6/10");
    expect(crawl?.querySelector('[data-crawl-skipped-reason="same_host"]')?.textContent).toContain(expected.sameHost);
    expect(crawl?.querySelector('[data-crawl-skipped-reason="same_host"]')?.textContent).toContain("1");
  });

  it("§8-13: a heuristic question chip is third-party coloured and the outline is unavailable", async () => {
    const brief = validContentBrief({}, { llm: "validation_failed" });
    if (brief.run.reads.llm.status !== "unavailable") throw new Error("fixture");
    const host = await render(expected.locale, brief);
    const chips = [...host.querySelectorAll("[data-must-answer-item] [data-source-chip]")];
    expect(chips.length).toBeGreaterThan(0);
    for (const chip of chips) {
      expect(chip.getAttribute("data-source-tone")).toBe("third");
      expect(chip.getAttribute("data-source-method")).toBe("heuristic");
    }
    expect(host.querySelector("[data-outline]")?.getAttribute("data-field-status")).toBe("unavailable");
    expect(host.querySelector("[data-outline] [data-unavailable-reason]")?.getAttribute("data-unavailable-reason")).toBe("validation_failed");
    expect(host.querySelector('[data-coverage-cell="llm"]')?.getAttribute("data-coverage-status")).toBe("unavailable");
  });

  it("§8-14: an unconfigured model says 'not configured', not a generic unavailable", async () => {
    const brief = withRun(validContentBrief(), {
      mode: "degraded",
      reads: {
        llm: {
          status: "unavailable",
          reason: "not_configured",
          attempted: 0,
          calls: 0,
          model_id: null,
          input_tokens: null,
          output_tokens: null,
        },
      },
    });
    const host = await render(expected.locale, brief);
    expect(text(host, '[data-coverage-cell="llm"]')).toContain(expected.notConfigured);
  });

  it("§8-16: a non-whitespace language marks three cards unsupported and zero sections writable", async () => {
    const brief = validContentBrief({}, { language: "zh" });
    if (brief.run.mode !== "degraded" || brief.draft_readiness.writable.length !== 0) {
      throw new Error("fixture");
    }
    const host = await render(expected.locale, brief);
    for (const selector of ['[data-field-card="length"]', "[data-must-answer]", "[data-outline]"]) {
      expect(text(host, selector)).toContain(expected.unsupported);
    }
    expect(text(host, "[data-readiness-summary]")).toContain(expected.readiness);
    expect(text(host, "[data-readiness-unsupported]")).toContain(expected.draftUnsupported);
    // Verdict, intent and format still render as usual.
    expect(host.querySelector("[data-verdict-card]")).not.toBeNull();
    expect(host.querySelector('[data-field-card="intent"]')?.getAttribute("data-field-status")).toBe("available");
    expect(host.querySelector('[data-field-card="format"]')?.getAttribute("data-field-status")).toBe("available");
    expect(host.querySelector("[data-mode-badge]")?.textContent).toBe(
      expected.locale === "en" ? "degraded" : "降级",
    );
  });

  it("reads every denominator from run.reads, not from the field's own copy", async () => {
    // completeC5: five full pages, so the length field is available.
    const base = validContentBrief({}, { completeC5: true });
    const format = base.format;
    const gapAngle: ContentBrief["gap_angle"] = {
      status: "available",
      value: "Approval workflows for regulated teams",
      rationale: "None of the observed pages addresses audit trails.",
      provenance: { method: "model", derived_from: ["crawl", "product_profile"] },
      profile_fact_refs: ["P1"],
      // A drifted copy: two ids where the run observed six pages.
      checked_against: ["C1", "C2"],
    };
    if (format.status !== "available") throw new Error("fixture");
    const brief = withRun(
      {
        ...base,
        // Field copies moved; the displayed denominators must not.
        format: { ...format, classified: 4, unknown_count: 6 },
        gap_angle: gapAngle,
        evidence: {
          ...base.evidence,
          profile: {
            facts: [
              {
                id: "P1",
                field: "positioning",
                text: "Built for teams that must keep an audit trail.",
                derivation: "declared",
                provenance: { method: "observed", origin: "product_profile" },
              },
            ],
          },
        },
      },
      {
        reads: {
          product_profile: {
            status: "complete",
            website_id: "site_1",
            snapshot_revision: 3,
            profile_hash: "sha256:profile",
          },
        },
      },
    );
    const host = await render(expected.locale, brief);
    // Format: top count (guide x5) over run.reads.serp.returned (10), unknown listed apart.
    expect(text(host, "[data-format-top-share]")).toContain("5/10");
    expect(text(host, "[data-format-top-share]")).not.toContain("/4");
    expect(text(host, "[data-format-unknown-count]")).toContain("6");
    // Length: pages_counted over run.reads.crawl.observed (6).
    expect(text(host, "[data-length-pages-counted]")).toContain("5/6");
    // Gap angle: the run's observed count, with the drifted copy called out.
    const checked = text(host, "[data-checked-against]");
    expect(checked).toContain("6");
    expect(checked).toContain("2");
    expect(checked).toContain(expected.checkedMismatch);

    // And the same brief with a faithful copy prints the plain sentence.
    const faithful = await render(expected.locale, {
      ...brief,
      gap_angle: { ...gapAngle, checked_against: ["C1", "C2", "C3", "C4", "C5", "C6"] },
    });
    expect(text(faithful, "[data-checked-against]")).toContain("6");
    expect(text(faithful, "[data-checked-against]")).not.toContain(expected.checkedMismatch);
  });

  it("prints 'not known' for attempted: null instead of a zero", async () => {
    const brief = validContentBrief({
      length: { status: "unavailable", reason: "insufficient_evidence", attempted: null },
      must_answer: { status: "unavailable", reason: "insufficient_evidence", attempted: null },
    });
    const host = await render(expected.locale, brief);
    for (const selector of ['[data-field-card="length"]', "[data-must-answer]"]) {
      const card = text(host, selector);
      expect(card).toContain(expected.attemptsNotKnown);
      expect(card).not.toContain(expected.attempted(0));
      expect(card).not.toContain("observed 0");
      expect(host.querySelector(`${selector} [data-attempted-unknown]`)).not.toBeNull();
    }
    // A numeric zero still prints as zero.
    const zero = await render(
      expected.locale,
      validContentBrief({
        length: { status: "unavailable", reason: "insufficient_evidence", attempted: 0 },
      }),
    );
    expect(text(zero, '[data-field-card="length"]')).toContain(expected.attempted(0));
  });

  it("prints the SERP rows the provider returned but could not resolve", async () => {
    const brief = withRun(validContentBrief(), {
      reads: { serp: { status: "partial", requested: 10, returned: 9, unresolved: 1 } },
    });
    const host = await render(expected.locale, brief);
    const serp = host.querySelector('[data-coverage-cell="serp"]');
    expect(serp?.textContent).toContain("9/10");
    expect(serp?.querySelector("[data-serp-unresolved]")?.textContent).toContain("1");
    expect(serp?.getAttribute("data-coverage-status")).toBe("partial");
  });

  it("prints the three GSC row denominators and the page-ledger share from run.reads", async () => {
    const base = validContentBrief();
    const brief = withRun(
      {
        ...base,
        evidence: {
          ...base.evidence,
          gsc_pages: [
            { id: "G1", page: "https://acme.example/blog/a", clicks: 4, impressions: 120, position: 8.2 },
            { id: "G2", page: "https://acme.example/blog/b", clicks: 1, impressions: 60, position: null },
          ],
        },
        internal_links: {
          status: "available",
          items: [
            {
              page_ref: "G1",
              why: "Answers the definition question.",
              why_provenance: { method: "model", derived_from: ["crawl", "gsc"] },
            },
          ],
        },
        do_not_cover: { status: "available", items: [] },
      },
      {
        reads: {
          gsc: {
            status: "partial",
            property: "sc-domain:acme.example",
            window: { start: "2026-07-30", end: "2026-08-26", lookback_days: 28 },
            matched_queries: 2,
            primary_coverage: { ratio: 0.91 },
            truncated: ["page"],
            rows: { query: 1_200, query_page: 3_400, page: 57 },
            unreadable_rows: { query: 0, query_page: 3, page: 1 },
          },
        },
      },
    );
    const host = await render(expected.locale, brief);
    const rows = text(host, '[data-coverage-cell="gsc"] [data-gsc-rows]');
    expect(rows).toContain("1,200");
    expect(rows).toContain("3,400");
    expect(rows).toContain("57");
    // Unreadable is the sum of the three, printed beside the rows it is missing from.
    expect(rows).toContain("4");
    expect(rows).not.toContain("{");
    // Two pages made the ledger out of 57 usable page rows.
    const ledger = text(host, '[data-links-card="internal-links"] [data-links-ledger]');
    expect(ledger).toContain("2");
    expect(ledger).toContain("57");
    expect(ledger).toContain(expected.ledgerWord);
    expect(host.querySelector('[data-links-card="do-not-cover"] [data-links-ledger]')?.textContent).toContain("57");
    // Not requested: no ledger line at all, rather than "0 / 0".
    const none = await render(expected.locale, validContentBrief());
    expect(none.querySelector("[data-links-ledger]")).toBeNull();
    expect(none.querySelector("[data-gsc-rows]")).toBeNull();
  });

  it("keeps the full derived-from list in the chip text, not only in a tooltip", async () => {
    const host = await render(expected.locale, validContentBrief());
    const chip = host.querySelector("[data-outline-item] [data-source-chip]");
    expect(chip?.textContent).toContain(expected.derivedFromCrawl);
    expect(chip?.getAttribute("title")).toBeNull();
    expect(chip?.className).not.toContain("truncate");
  });

  it("names the model as deployment-reported and never claims the effective temperature", async () => {
    const brief = await withFingerprint(validContentBrief());
    const host = await render(expected.locale, brief);
    const header = text(host, "[data-run-header]");
    expect(header).toContain("gpt-4.1-brief");
    expect(header).toContain(expected.modelReported);
    expect(header).toContain(expected.tempNotReported);
    expect(host.querySelector("[data-temperature-effective]")?.getAttribute("data-temperature-effective")).toBe("not_reported");
    expect(brief.run.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(text(host, "[data-run-fingerprint]")).toBe(brief.run.fingerprint);
  });

  it("renders coverage only when the run had no SERP", async () => {
    const brief = validContentBrief({}, { serp: "unavailable" });
    if (brief.run.mode !== "unavailable") throw new Error("fixture");
    const host = await render(expected.locale, brief);
    expect(host.querySelector("[data-evidence-coverage]")).not.toBeNull();
    expect(host.querySelector("[data-verdict-card]")).toBeNull();
    expect(host.querySelector("[data-must-answer]")).toBeNull();
    expect(host.querySelector("[data-wont-say]")).not.toBeNull();
  });

  it("ships no literal key path anywhere on the surface", async () => {
    const host = await render(expected.locale, validContentBrief());
    // Key paths, not words: "coverage." also ends an English sentence.
    for (const keyPath of [
      "tools.contentBrief",
      "verdict.undecidable.",
      "verdict.create.",
      "modes.partial",
      "modeBody.",
      "coverage.crawlObserved",
      "coverage.serpRows",
      "mustAnswer.budget",
      "mustAnswer.coveredBy",
      "outline.answers",
      "readiness.summary",
      "sources.origins",
      "sources.methods",
      "wontSay.",
      "unavailable.not_requested",
      "links.reason",
    ]) {
      expect(host.textContent).not.toContain(keyPath);
    }
    expect(host.textContent).not.toMatch(/\{[a-zA-Z]+\}/);
  });
});
