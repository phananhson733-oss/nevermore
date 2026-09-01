import { describe, expect, it } from "vitest";

import {
  CITABILITY_RETRIEVAL_BOTS,
  CITABILITY_TRAINING_BOTS,
  type CitabilityCheck,
  type CitabilityInput,
} from "./citability-contract.ts";
import { buildCitabilityReport, runCitabilityChecks } from "./citability-rules.ts";
import { measureCitabilityRender } from "./citability-render.ts";
import { buildCitabilityConclusion } from "./citability-conclusion.ts";

const BODY = `<p>${"内容".repeat(300)}</p>`;

function input(overrides: Partial<CitabilityInput> = {}): CitabilityInput {
  return {
    url: "https://example.com/guide",
    finalUrl: "https://example.com/guide",
    rawHtml: `<html><head><link rel="canonical" href="https://example.com/guide"></head><body>${BODY}</body></html>`,
    bodyComplete: true,
    robots: { status: "ok", text: "User-agent: *\nAllow: /\n" },
    llmsTxt: { status: "ok", bytes: 120 },
    targetQuestion: null,
    ...overrides,
  };
}

function byId(checks: readonly CitabilityCheck[], id: string): CitabilityCheck {
  const found = checks.find((check) => check.ruleId === id);
  if (!found) throw new Error(`no check ${id}`);
  return found;
}

describe("check inventory", () => {
  it("returns fourteen rows: ten counted and four advisory", () => {
    const checks = runCitabilityChecks(input());
    expect(checks).toHaveLength(14);
    expect(checks.filter((check) => check.weight === "counted")).toHaveLength(10);
    expect(checks.filter((check) => check.weight === "advisory")).toHaveLength(4);
    expect(checks.filter((check) => check.weight === "counted" && check.section === "readable")).toHaveLength(5);
    expect(checks.filter((check) => check.weight === "counted" && check.section === "extractable")).toHaveLength(5);
  });

  it("counts the retrieval crawlers and only shows the training ones", () => {
    const checks = runCitabilityChecks(input());
    expect(CITABILITY_RETRIEVAL_BOTS).toEqual(["OAI-SearchBot", "ChatGPT-User", "PerplexityBot"]);
    expect(CITABILITY_TRAINING_BOTS).toContain("ClaudeBot");
    for (const bot of CITABILITY_RETRIEVAL_BOTS) {
      expect(byId(checks, `robots.${bot.toLowerCase()}`).weight).toBe("counted");
    }
    for (const bot of CITABILITY_TRAINING_BOTS) {
      expect(byId(checks, `robots.${bot.toLowerCase()}`).weight).toBe("advisory");
    }
  });

  it("gives every failed check a fix and no passing check one", () => {
    const checks = runCitabilityChecks(
      input({ rawHtml: "<html><body><div id=\"root\"></div></body></html>" }),
    );
    for (const check of checks) {
      if (check.state === "fail") expect(check.fix).toBeDefined();
      else expect(check.fix).toBeUndefined();
    }
  });

  it("marks exactly the three pattern-proxy rules as heuristic", () => {
    const heuristics = runCitabilityChecks(input())
      .filter((check) => check.kind === "heuristic")
      .map((check) => check.ruleId)
      .sort();
    expect(heuristics).toEqual(["citedData", "leadAnswer", "qualifiers"]);
  });
});

describe("robots", () => {
  it("keeps a ClaudeBot-only training block out of the summary and retrieval root cause", () => {
    const allowed = buildCitabilityReport(input(), "2026-08-31T00:00:00.000Z");
    const blocked = buildCitabilityReport(input({ robots: { status: "ok", text: "User-agent: ClaudeBot\nDisallow: /\n" } }), allowed.fetchedAt);
    expect(byId(blocked.checks, "robots.claudebot")).toMatchObject({ weight: "advisory", state: "fail", fix: { key: "robots.advisoryDisallowed" } });
    expect(blocked.summary).toEqual(allowed.summary);
    expect(blocked.rootCauses.find((cause) => cause.id === "crawlerAccess")).toBeUndefined();
    expect(blocked.rootCauses.find((cause) => cause.id === "advisory")?.checkIds).toContain("robots.claudebot");
  });

  it("treats a missing robots.txt as full allowance, not as a failure", () => {
    const checks = runCitabilityChecks(
      input({ robots: { status: "absent", httpStatus: 404 } }),
    );
    const check = byId(checks, "robots.oai-searchbot");
    expect(check.state).toBe("pass");
    expect(check.measured.key).toBe("robots.absent");
  });

  it("separates an unreachable robots.txt from a missing one", () => {
    const checks = runCitabilityChecks(
      input({ robots: { status: "unreachable", httpStatus: 500 } }),
    );
    const check = byId(checks, "robots.claudebot");
    expect(check.state).toBe("fetchError");
    expect(check.measured.key).toBe("robots.unreachable");
  });

  it("names the disallowing pattern", () => {
    const checks = runCitabilityChecks(
      input({
        robots: {
          status: "ok",
          text: "User-agent: ChatGPT-User\nDisallow: /guide\n",
        },
      }),
    );
    const check = byId(checks, "robots.chatgpt-user");
    expect(check.state).toBe("fail");
    expect(check.measured.values?.pattern).toBe("/guide");
    // A sibling retrieval bot is unaffected by a rule that names one agent.
    expect(byId(checks, "robots.perplexitybot").state).toBe("pass");
  });

  it("evaluates the query string, not just the path", () => {
    const checks = runCitabilityChecks(
      input({
        url: "https://example.com/guide?ref=x",
        finalUrl: "https://example.com/guide?ref=x",
        robots: { status: "ok", text: "User-agent: *\nDisallow: /*?\n" },
      }),
    );
    expect(byId(checks, "robots.oai-searchbot").state).toBe("fail");
  });
});

describe("ssr", () => {
  it("cannot pass a raw/render comparison without a renderer measurement", () => {
    const check = byId(runCitabilityChecks(input()), "ssr");
    expect(check.state).toBe("fetchError");
    expect(check.measured.key).toBe("ssr.renderUnavailable");
  });

  it("uses the Artifact 30 percent raw/render threshold", () => {
    const page = input({ rawHtml: `<body>${"x".repeat(500)}</body>` });
    const render = measureCitabilityRender({ url: page.finalUrl, rawHtml: page.rawHtml, bodyComplete: true }, `<body>${"x".repeat(2000)}</body>`);
    const check = byId(runCitabilityChecks({ ...page, render }), "ssr");
    expect(check.state).toBe("fail");
    expect(check.measured.key).toBe("ssr.renderRatio");
    expect(check.measured.values).toEqual({ raw: 500, rendered: 2000, ratio: 25, threshold: 30 });
  });

  it("fails an empty client-rendered shell instead of passing it", () => {
    const shell = `<html><body><div id="__nuxt"></div><script>${"x".repeat(20_000)}</script></body></html>`;
    const check = byId(runCitabilityChecks(input({ rawHtml: shell, render: measureCitabilityRender({ url: "https://example.com/guide", rawHtml: shell, bodyComplete: true }, `<body>${BODY}</body>`) })), "ssr");
    expect(check.state).toBe("fail");
    expect(check.measured.key).toBe("ssr.renderRatio");
  });

  it("fails a client-rendered page whose mount container has no known id", () => {
    // The container-id allowlist was the old trigger, so Nuxt, Svelte and an
    // App Router shell all slipped through as a pass.
    const shell = `<html><body><div id="mount-here"><span>Loading</span></div><script>${"y".repeat(20_000)}</script></body></html>`;
    const check = byId(runCitabilityChecks(input({ rawHtml: shell, render: measureCitabilityRender({ url: "https://example.com/guide", rawHtml: shell, bodyComplete: true }, `<body>${BODY}</body>`) })), "ssr");
    expect(check.state).toBe("fail");
    expect(check.measured.key).toBe("ssr.renderRatio");
  });

  it("separates a thin page from a client-rendered one", () => {
    const thin = "<html><body><p>Short page.</p></body></html>";
    const check = byId(runCitabilityChecks(input({ rawHtml: thin, render: measureCitabilityRender({ url: "https://example.com/guide", rawHtml: thin, bodyComplete: true }, thin) })), "ssr");
    expect(check.state).toBe("fail");
    expect(check.measured.key).toBe("ssr.thin");
  });
});

describe("canonical", () => {
  it("accepts href before rel and multiple rel tokens", () => {
    const html = `<html><head><link href="https://example.com/guide" rel="canonical alternate"></head><body>${BODY}</body></html>`;
    expect(byId(runCitabilityChecks(input({ rawHtml: html })), "canonical").state).toBe(
      "pass",
    );
  });

  it("reports a canonical that points elsewhere without claiming the target works", () => {
    const html = `<html><head><link rel="canonical" href="/other"></head><body>${BODY}</body></html>`;
    const check = byId(runCitabilityChecks(input({ rawHtml: html })), "canonical");
    expect(check.state).toBe("fail");
    expect(check.measured.key).toBe("canonical.other");
    expect(check.measured.values?.href).toBe("https://example.com/other");
  });
});

describe("llms.txt", () => {
  it("stays advisory in every branch and never claims the file parsed", () => {
    const present = byId(runCitabilityChecks(input()), "llmsTxt");
    expect(present.weight).toBe("advisory");
    expect(present.measured.key).toBe("llms.present");

    const absent = byId(
      runCitabilityChecks(
        input({ llmsTxt: { status: "absent", httpStatus: 404 } }),
      ),
      "llmsTxt",
    );
    expect(absent.state).toBe("fail");
    expect(absent.weight).toBe("advisory");
  });

  it("keeps advisory rows out of the counted summary", () => {
    const report = buildCitabilityReport(
      input({ llmsTxt: { status: "absent", httpStatus: 404 } }),
      "2026-08-29T00:00:00.000Z",
    );
    expect(report.summary.total).toBe(14);
    expect(report.summary.counted + report.summary.fetchError + report.summary.notApplicable).toBe(
      10,
    );
  });
});

describe("lead answer", () => {
  it("is not applicable when no question was asked", () => {
    const check = byId(runCitabilityChecks(input()), "leadAnswer");
    expect(check.state).toBe("notApplicable");
    expect(check.measured.key).toBe("leadAnswer.notAsked");
  });

  it("does not accept a conclusion marker found inside another word", () => {
    const html =
      "<html><body><p>This history of houses and their users continues for a while, with plenty of prose and no verdict at all in the opening.</p></body></html>";
    const check = byId(
      runCitabilityChecks(
        input({ rawHtml: html, targetQuestion: "which crm is best for agencies" }),
      ),
      "leadAnswer",
    );
    // "this"/"history"/"houses"/"users" contain is/are/use as substrings.
    expect(check.state).toBe("fail");
  });

  it("passes when the opening names the question and states a verdict", () => {
    const html =
      "<html><body><p>Linear is the best issue tracker for small agencies, and here is why.</p></body></html>";
    const check = byId(
      runCitabilityChecks(
        input({
          rawHtml: html,
          targetQuestion: "best issue tracker for small agencies",
        }),
      ),
      "leadAnswer",
    );
    expect(check.state).toBe("pass");
  });
});

describe("extractable structure", () => {
  it("does not count an empty table or a link list", () => {
    const html = `<html><body><table></table><ul><li><a href="/a">A</a></li><li><a href="/b">B</a></li><li><a href="/c">C</a></li></ul>${BODY}</body></html>`;
    const check = byId(
      runCitabilityChecks(input({ rawHtml: html })),
      "extractableStructure",
    );
    expect(check.state).toBe("fail");
  });

  it("counts a table with cells", () => {
    const html = `<html><body><table><tr><td>Plan</td><td>Price</td></tr></table>${BODY}</body></html>`;
    const check = byId(
      runCitabilityChecks(input({ rawHtml: html })),
      "extractableStructure",
    );
    expect(check.state).toBe("pass");
    expect(check.measured.values?.tables).toBe(1);
  });
});

describe("qualifiers", () => {
  it("does not accept a bare year range as a qualified condition", () => {
    const html = `<html><body><p>Copyright 2020-2026 Example Inc. ${"文字".repeat(200)}</p></body></html>`;
    expect(byId(runCitabilityChecks(input({ rawHtml: html })), "qualifiers").state).toBe(
      "fail",
    );
  });

  it("reads a Chinese quantified condition that has no ASCII word boundary", () => {
    const html = `<html><body><p>适合至少 5 人的团队使用。${"文字".repeat(200)}</p></body></html>`;
    expect(byId(runCitabilityChecks(input({ rawHtml: html })), "qualifiers").state).toBe(
      "pass",
    );
  });
});

describe("cited data", () => {
  it.each(["2000 companies use the service.", "We serve 2025 customers.", "价格为 1999 元。", "The price is $1999."])(
    "does not erase a year-shaped quantity from a numerical sentence: %s", (sentence) => {
      const html = `<body><p>${sentence}</p></body>`;
      expect(byId(runCitabilityChecks(input({ rawHtml: html })), "citedData")).toMatchObject({
        state: "fail", measured: { key: "citedData.unsourced", values: { total: 1, unsourced: 1 } },
      });
    },
  );

  it.each(["2025", "2025-08-31", "2025年8月31日", "Copyright 2020-2026", "Published in 2025", "Updated Q3 2025"])(
    "keeps recognizable dates outside the numeric-statement scan: %s", (sentence) => {
      const html = `<body><p>${sentence}</p></body>`;
      expect(byId(runCitabilityChecks(input({ rawHtml: html })), "citedData")).toMatchObject({
        state: "notApplicable", measured: { key: "citedData.noNumbers" },
      });
    },
  );

  it("only records a source cue, not verified factual support, for an arbitrary signup link", () => {
    const html = `<body><p>Revenue grew 15% <a href="/signup">start your free trial</a>.</p></body>`;
    const check = byId(runCitabilityChecks(input({ rawHtml: html })), "citedData");
    // A link is observable. Its relevance, contents, and support for the
    // numeric statement are not established by this local pattern scan.
    expect(check).toMatchObject({
      kind: "heuristic",
      state: "pass",
      measured: { key: "citedData.allSourced", values: { total: 1 } },
    });
  });

  it.each([
    { rawHtml: "<body>No numerical statements.</body>", bodyComplete: true, state: "notApplicable" },
    { rawHtml: "<body>Revenue grew 15%.</body>", bodyComplete: true, state: "fail" },
    { rawHtml: "<body>Revenue grew 15%.", bodyComplete: false, state: "fetchError" },
  ])("keeps the $state source-cue branch heuristic", ({ rawHtml, bodyComplete, state }) => {
    expect(byId(runCitabilityChecks(input({ rawHtml, bodyComplete })), "citedData")).toMatchObject({
      kind: "heuristic",
      state,
    });
  });

  it("is not applicable when the page makes no numeric claim", () => {
    const check = byId(runCitabilityChecks(input()), "citedData");
    expect(check.state).toBe("notApplicable");
  });

  it("splits Chinese sentences so one source does not vouch for the whole page", () => {
    const html = `<html><body><p>收入增长 15%。用户数增长 30%。数据来源：年报。</p>${BODY}</body></html>`;
    const check = byId(runCitabilityChecks(input({ rawHtml: html })), "citedData");
    expect(check.state).toBe("fail");
    // The trailing "数据来源" sentence carries no number of its own, so it is
    // not a numeric claim - and it does not vouch for the two that precede it.
    expect(check.measured.values?.unsourced).toBe(2);
    expect(check.measured.values?.total).toBe(2);
  });

  it("sees a link next to the number even though tags are stripped", () => {
    const html = `<html><body><p>Revenue grew 15% <a href="https://sec.gov/report">per the filing</a>.</p>${BODY}</body></html>`;
    const check = byId(runCitabilityChecks(input({ rawHtml: html })), "citedData");
    expect(check.state).toBe("pass");
  });

  it("does not accept a bare year as a source", () => {
    const html = `<html><body><p>Revenue grew 15% in 2025 across the business.</p>${BODY}</body></html>`;
    const check = byId(runCitabilityChecks(input({ rawHtml: html })), "citedData");
    expect(check.state).toBe("fail");
  });
});

describe("faq schema", () => {
  const faq = (nodes: unknown) =>
    `<html><body><script type="application/ld+json">${JSON.stringify(nodes)}</script>${BODY}</body></html>`;

  it("accepts multiple explicitly typed accepted answers", () => {
    const html = faq({
      "@type": "FAQPage",
      mainEntity: [{
        "@type": "Question", name: "How?",
        acceptedAnswer: [{ "@type": "Answer", text: "First way." }, { "@type": ["Answer"], text: "Second way." }],
      }],
    });
    expect(byId(runCitabilityChecks(input({ rawHtml: html })), "faqSchema")).toMatchObject({
      state: "pass", measured: { key: "faq.valid", values: { count: 1 } },
    });
  });

  it("keeps a malformed answer from hiding behind a well-shaped answer", () => {
    const html = faq({
      "@type": "FAQPage",
      mainEntity: [{
        "@type": "Question", name: "How?",
        acceptedAnswer: [{ "@type": "Answer", text: "First way." }, { "@type": "Product", text: "Not an answer." }],
      }],
    });
    expect(byId(runCitabilityChecks(input({ rawHtml: html })), "faqSchema").state).toBe("fail");
  });

  it("reads a singleton @graph object", () => {
    const html = faq({ "@graph": {
      "@type": "FAQPage",
      mainEntity: { "@type": "Question", name: "Q", acceptedAnswer: { "@type": "Answer", text: "A" } },
    } });
    expect(byId(runCitabilityChecks(input({ rawHtml: html })), "faqSchema").state).toBe("pass");
  });

  it.each([
    { label: "unvisited FAQ", before: true },
    { label: "unvisited nodes after a valid FAQ", before: false },
  ])("does not conclude from an incomplete JSON-LD scan: $label", ({ before }) => {
    const node = { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Q", acceptedAnswer: { "@type": "Answer", text: "A" } }] };
    const padding = Array.from({ length: 20_000 }, () => null);
    const html = faq(before ? [node, ...padding] : [...padding, node]);
    expect(byId(runCitabilityChecks(input({ rawHtml: html })), "faqSchema")).toMatchObject({
      state: "fetchError", measured: { key: "faq.scanIncomplete", values: { limit: 20_000 } },
    });
  });

  it("does not call unparseable JSON-LD confirmed absence of FAQ markup", () => {
    const html = `<body><script type="application/ld+json">{ broken</script></body>`;
    expect(byId(runCitabilityChecks(input({ rawHtml: html })), "faqSchema")).toMatchObject({
      state: "fetchError", measured: { key: "faq.noneWithBroken", values: { broken: 1 } },
    });
  });

  it.each([
    { mainEntity: { "@id": "#question" } },
    { mainEntity: { "@type": "Question", name: "Q", acceptedAnswer: { "@id": "#answer" } } },
  ])("reports unresolved node references as unverified, not malformed FAQ: %j", ({ mainEntity }) => {
    const html = faq({ "@type": "FAQPage", mainEntity });
    expect(byId(runCitabilityChecks(input({ rawHtml: html })), "faqSchema")).toMatchObject({
      state: "fetchError", measured: { key: "faq.referencesNotResolved" },
    });
  });

  it.each([
    { questionType: "Person", answerType: "Answer" },
    { questionType: "Question", answerType: "Product" },
    { questionType: "Person", answerType: "Product" },
    { questionType: undefined, answerType: "Answer" },
    { questionType: "Question", answerType: undefined },
    { questionType: "https://example.com/Question", answerType: "Answer" },
  ])("rejects non-Question/Answer types despite non-empty fields: $questionType / $answerType", ({ questionType, answerType }) => {
    const html = faq({
      "@type": "FAQPage",
      mainEntity: [{
        "@type": questionType,
        name: "Does it work?",
        acceptedAnswer: { "@type": answerType, text: "Yes." },
      }],
    });
    expect(byId(runCitabilityChecks(input({ rawHtml: html })), "faqSchema")).toMatchObject({
      state: "fail",
      measured: { key: "faq.incomplete", values: { incomplete: 1, total: 1 } },
    });
  });

  it.each([
    { faqType: "FAQPage" },
    { faqType: "http://schema.org/FAQPage" },
    { faqType: "https://schema.org/FAQPage" },
    { faqType: ["WebPage", "https://schema.org/FAQPage"] },
  ])(
    "accepts supported Schema.org type forms and a single mainEntity: $faqType",
    ({ faqType }) => {
      const html = faq({
        "@type": faqType,
        mainEntity: {
          "@type": ["Thing", "https://schema.org/Question"],
          name: "Does it work?",
          acceptedAnswer: { "@type": "http://schema.org/Answer", text: "Yes." },
        },
      });
      expect(byId(runCitabilityChecks(input({ rawHtml: html })), "faqSchema")).toMatchObject({
        state: "pass",
        measured: { key: "faq.valid", values: { count: 1 } },
      });
    },
  );

  it("does not hide an empty FAQPage behind another complete node", () => {
    const html = faq([
      { "@type": "FAQPage", mainEntity: [] },
      { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Q", acceptedAnswer: { "@type": "Answer", text: "A" } }] },
    ]);
    expect(byId(runCitabilityChecks(input({ rawHtml: html })), "faqSchema")).toMatchObject({
      state: "fail",
      measured: { key: "faq.emptyMainEntity" },
    });
  });

  it("is not applicable when the page declares no FAQ markup", () => {
    const check = byId(runCitabilityChecks(input()), "faqSchema");
    expect(check.state).toBe("notApplicable");
  });

  it("finds a FAQPage inside @graph and a @type array", () => {
    const html = faq({
      "@graph": [
        {
          "@type": ["WebPage", "FAQPage"],
          mainEntity: [
            {
              "@type": "Question",
              name: "Does it work?",
              acceptedAnswer: { "@type": "Answer", text: "Yes." },
            },
          ],
        },
      ],
    });
    const check = byId(runCitabilityChecks(input({ rawHtml: html })), "faqSchema");
    expect(check.state).toBe("pass");
    expect(check.measured.values?.count).toBe(1);
  });

  it("does not let one broken block hide a valid one", () => {
    const html = `<html><body><script type="application/ld+json">{ broken</script><script type="application/ld+json">${JSON.stringify(
      {
        "@type": "FAQPage",
        mainEntity: [
          {
            "@type": "Question",
            name: "Q",
            acceptedAnswer: { "@type": "Answer", text: "A" },
          },
        ],
      },
    )}</script>${BODY}</body></html>`;
    expect(byId(runCitabilityChecks(input({ rawHtml: html })), "faqSchema").state).toBe(
      "pass",
    );
  });

  it("fails a FAQPage whose answers are empty", () => {
    const html = faq({
      "@type": "FAQPage",
      mainEntity: [{ "@type": "Question", name: "Q" }],
    });
    const check = byId(runCitabilityChecks(input({ rawHtml: html })), "faqSchema");
    expect(check.state).toBe("fail");
    expect(check.measured.key).toBe("faq.incomplete");
  });
});

describe("report", () => {
  it("assembles the conclusion from the exact report checks, render capture, and question", () => {
    const report = buildCitabilityReport(input({ targetQuestion: "What is this page about?" }), "2026-08-31T00:00:00.000Z");
    expect(report.conclusion).toEqual(buildCitabilityConclusion(report));
    expect(report.conclusion).toMatchObject({ schemaVersion: "marketing-citability-conclusion.v1", coverage: "partial" });
    expect(report.conclusion.unknownCheckIds).toContain("ssr");
    expect(byId(report.checks, "citedData").kind).toBe("heuristic");
  });

  it("uses the actual captured raw visible count in the report summary", () => {
    const page = input();
    const rawCapture = { method: "browser_visible_text" as const, text: "", textChars: 0, complete: true };
    const render = measureCitabilityRender({ url: page.finalUrl, rawHtml: page.rawHtml, bodyComplete: true }, null, { rawCapture, renderedCapture: rawCapture });
    expect(buildCitabilityReport({ ...page, render }, "2026-08-31T00:00:00.000Z").textChars).toBe(0);
  });
  it("carries the derived question terms and the stated limits", () => {
    const report = buildCitabilityReport(
      input({ targetQuestion: "best issue tracker for small agencies" }),
      "2026-08-29T00:00:00.000Z",
    );
    expect(report.questionTerms).toContain("tracker");
    expect(report.questionTerms).not.toContain("for");
    expect(report.limits).toContain("boundedRendering");
    expect(report.fetchedAt).toBe("2026-08-29T00:00:00.000Z");
  });
});
