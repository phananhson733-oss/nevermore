import { describe, expect, it } from "vitest";

import {
  CITABILITY_RETRIEVAL_BOTS,
  CITABILITY_TRAINING_BOTS,
  type CitabilityCheck,
  type CitabilityInput,
} from "./citability-contract.ts";
import { buildCitabilityReport, runCitabilityChecks } from "./citability-rules.ts";
import { measureCitabilityRender } from "./citability-render.ts";

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

  it("marks exactly the two pattern-proxy rules as heuristic", () => {
    const heuristics = runCitabilityChecks(input())
      .filter((check) => check.kind === "heuristic")
      .map((check) => check.ruleId)
      .sort();
    expect(heuristics).toEqual(["leadAnswer", "qualifiers"]);
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
