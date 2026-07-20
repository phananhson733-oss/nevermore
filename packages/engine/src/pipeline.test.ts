import { describe, expect, it, vi } from "vitest";

import { DiagnosticContext } from "./context.ts";
import { parseIcp } from "./icp.ts";
import { runPipeline } from "./pipeline.ts";
import type {
  DiagnosticRule,
  EvidenceDraft,
  FindingCandidate,
} from "./rule.ts";

function emptyContext(): DiagnosticContext {
  return DiagnosticContext.build({
    icp: parseIcp({ productName: "Pipeline fixture" }),
    deliveryLocale: "en",
    observations: [],
    coverage: {
      crawl: "available",
      gsc: "available",
      ga4: "available",
      csv: "available",
    },
    capturedAt: {},
  });
}

function observedEvidence(subjectRef: string): EvidenceDraft {
  return {
    sourceProvider: "crawl",
    origin: "direct_public",
    method: "observed",
    grade: "B",
    availability: "available",
    support: "supports",
    subjectRefs: [subjectRef],
    claim: "Observed directly in the frozen crawl snapshot.",
    observedAt: "2026-07-18T00:00:00.000Z",
    limitation: "Current public response only.",
  };
}

function candidate(
  subjectRef: string,
  evidenceSubjectRef: string,
): FindingCandidate {
  return {
    subjectRefs: [subjectRef],
    severity: "high",
    titleArgs: { status: 404, count: 1 },
    metrics: { count: 1 },
    evidence: [observedEvidence(evidenceSubjectRef)],
  };
}

describe("runPipeline async rule contract (spec §8.3)", () => {
  it("awaits each rule in registry order", async () => {
    const events: string[] = [];
    const rules: DiagnosticRule[] = [
      {
        id: "TECH-HTTP-001",
        version: 1,
        domain: "technical_seo",
        requiredDatasets: [],
        async evaluate() {
          events.push("first:start");
          await Promise.resolve();
          events.push("first:end");
          return { status: "pass", metrics: { first: 1 } };
        },
      },
      {
        id: "TECH-CANONICAL-002",
        version: 1,
        domain: "technical_seo",
        requiredDatasets: [],
        evaluate() {
          events.push("second:start");
          return { status: "pass", metrics: { second: 1 } };
        },
      },
    ];

    const result = await runPipeline({
      projectId: "00000000-0000-4000-8000-000000000001",
      ctx: emptyContext(),
      rules,
      deliveryLocale: "en",
    });

    expect(events).toEqual(["first:start", "first:end", "second:start"]);
    expect(result.ruleResults.map((row) => row.status)).toEqual([
      "pass",
      "pass",
    ]);
  });

  it("contains both synchronous throws and asynchronous rejections to the failing rule", async () => {
    const hostileToString = vi.fn(() => "customer-content-secret");
    const rules: DiagnosticRule[] = [
      {
        id: "TECH-HTTP-001",
        version: 1,
        domain: "technical_seo",
        requiredDatasets: [],
        evaluate() {
          throw new Error("sync customer-content-secret");
        },
      },
      {
        id: "TECH-CANONICAL-002",
        version: 1,
        domain: "technical_seo",
        requiredDatasets: [],
        async evaluate() {
          throw new Error("async customer-content-secret");
        },
      },
      {
        id: "TECH-LINKGRAPH-005",
        version: 1,
        domain: "technical_seo",
        requiredDatasets: [],
        evaluate() {
          throw {
            message: "customer-content-secret",
            toString: hostileToString,
          };
        },
      },
      {
        id: "CRO-PATH-001",
        version: 1,
        domain: "conversion_journey",
        requiredDatasets: [],
        evaluate() {
          return { status: "pass", metrics: { survived: 1 } };
        },
      },
    ];

    const result = await runPipeline({
      projectId: "00000000-0000-4000-8000-000000000001",
      ctx: emptyContext(),
      rules,
      deliveryLocale: "en",
    });

    expect(result.ruleResults).toEqual([
      expect.objectContaining({
        status: "inconclusive",
        reason: "rule_error",
      }),
      expect.objectContaining({
        status: "inconclusive",
        reason: "rule_error",
      }),
      expect.objectContaining({ status: "inconclusive", reason: "rule_error" }),
      expect.objectContaining({ status: "pass", reason: null }),
    ]);
    expect(JSON.stringify(result.ruleResults)).not.toContain(
      "customer-content-secret",
    );
    expect(hostileToString).not.toHaveBeenCalled();
    expect(result.ruleResults.every((row) => row.durationMs >= 0)).toBe(true);
  });

  it("finishes every deterministic rule before the optional LLM summary invocation (AC-023)", async () => {
    const events: string[] = [];
    const rules: DiagnosticRule[] = [
      {
        id: "TECH-HTTP-001",
        version: 1,
        domain: "technical_seo",
        requiredDatasets: [],
        async evaluate() {
          events.push("rule-1:start");
          await Promise.resolve();
          events.push("rule-1:end");
          return {
            status: "candidate",
            candidates: [
              candidate("http_status:500", "https://x.test/broken"),
            ],
          };
        },
      },
      {
        id: "TECH-CANONICAL-002",
        version: 1,
        domain: "technical_seo",
        requiredDatasets: [],
        evaluate() {
          events.push("rule-2");
          return { status: "pass", metrics: { clean: 1 } };
        },
      },
    ];

    const result = await runPipeline({
      projectId: "00000000-0000-4000-8000-000000000001",
      ctx: emptyContext(),
      rules,
      deliveryLocale: "fr-u-ca-gregory",
      summaryGenerator: async (input) => {
        events.push(`llm:${input.ruleId}`);
        return {
          summary: "Résumé généré à partir des faits autorisés.",
          summaryLocale: "fr-u-ca-gregory",
          invocationId: "00000000-0000-4000-8000-000000000099",
        };
      },
    });

    expect(events).toEqual([
      "rule-1:start",
      "rule-1:end",
      "rule-2",
      "llm:TECH-HTTP-001",
    ]);
    expect(result.findings[0]).toMatchObject({
      summary: "Résumé généré à partir des faits autorisés.",
      summaryLocale: "fr-u-ca-gregory",
      summaryInvocationId: "00000000-0000-4000-8000-000000000099",
    });
  });

  it.each([
    ["null result", async () => null],
    [
      "empty summary",
      async () => ({
        summary: "  ",
        summaryLocale: "fr",
        invocationId: "00000000-0000-4000-8000-000000000099",
      }),
    ],
    [
      "invalid locale",
      async () => ({
        summary: "résumé",
        summaryLocale: "not a locale",
        invocationId: "00000000-0000-4000-8000-000000000099",
      }),
    ],
    [
      "duplicate BCP-47 extension singleton",
      async () => ({
        summary: "résumé",
        summaryLocale: "fr-a-first-a-second",
        invocationId: "00000000-0000-4000-8000-000000000099",
      }),
    ],
    [
      "invalid invocation id",
      async () => ({
        summary: "résumé",
        summaryLocale: "fr",
        invocationId: "foreign-or-missing-invocation",
      }),
    ],
    ["provider rejection", async () => Promise.reject(new Error("offline"))],
  ])("falls back safely when summary generation returns %s", async (_label, generator) => {
    const result = await runPipeline({
      projectId: "00000000-0000-4000-8000-000000000001",
      ctx: emptyContext(),
      rules: [
        {
          id: "TECH-HTTP-001",
          version: 1,
          domain: "technical_seo",
          requiredDatasets: [],
          evaluate: () => ({
            status: "candidate",
            candidates: [candidate("http_status:500", "https://x.test/broken")],
          }),
        },
      ],
      deliveryLocale: "fr",
      summaryGenerator: generator,
    });

    expect(result.findings[0]).toMatchObject({
      summaryLocale: "en",
      summaryInvocationId: null,
    });
    expect(result.findings[0]?.summary.length).toBeGreaterThan(0);
  });

  it("does not invoke the optional generator for a deterministic locale", async () => {
    const generator = vi.fn();
    const result = await runPipeline({
      projectId: "00000000-0000-4000-8000-000000000001",
      ctx: emptyContext(),
      rules: [
        {
          id: "TECH-HTTP-001",
          version: 1,
          domain: "technical_seo",
          requiredDatasets: [],
          evaluate: () => ({
            status: "candidate",
            candidates: [candidate("http_status:500", "https://x.test/broken")],
          }),
        },
      ],
      deliveryLocale: "en-US",
      summaryGenerator: generator,
    });

    expect(generator).not.toHaveBeenCalled();
    expect(result.findings[0]?.summaryLocale).toBe("en");
  });

  it.each(["zh-TW", "zh-HK", "zh-Hant"])(
    "falls back to an honestly labelled English summary for %s when generation is disabled",
    async (locale) => {
      const result = await runPipeline({
        projectId: "00000000-0000-4000-8000-000000000001",
        ctx: emptyContext(),
        rules: [
          {
            id: "TECH-HTTP-001",
            version: 1,
            domain: "technical_seo",
            requiredDatasets: [],
            evaluate: () => ({
              status: "candidate",
              candidates: [candidate("http_status:500", "https://x.test/broken")],
            }),
          },
        ],
        deliveryLocale: locale,
      });

      expect(result.findings[0]).toMatchObject({
        summaryLocale: "en",
        summaryInvocationId: null,
      });
    },
  );

  it.each(["zh-TW", "zh-HK", "zh-Hant"])(
    "falls back to an honestly labelled English summary for %s when generation fails",
    async (locale) => {
      const result = await runPipeline({
        projectId: "00000000-0000-4000-8000-000000000001",
        ctx: emptyContext(),
        rules: [
          {
            id: "TECH-HTTP-001",
            version: 1,
            domain: "technical_seo",
            requiredDatasets: [],
            evaluate: () => ({
              status: "candidate",
              candidates: [candidate("http_status:500", "https://x.test/broken")],
            }),
          },
        ],
        deliveryLocale: locale,
        summaryGenerator: async () => {
          throw new Error("provider unavailable");
        },
      });

      expect(result.findings[0]).toMatchObject({
        summaryLocale: "en",
        summaryInvocationId: null,
      });
    },
  );
});

describe("runPipeline provider discrepancy confidence (spec §7.6, §8.7)", () => {
  it("downgrades only otherwise-high findings whose finding/evidence subjects overlap", async () => {
    const rule: DiagnosticRule = {
      id: "TECH-HTTP-001",
      version: 1,
      domain: "technical_seo",
      requiredDatasets: [],
      evaluate() {
        return {
          status: "candidate",
          candidates: [
            candidate("https://x.test/direct", "https://x.test/context"),
            candidate("http_status:404", "https://x.test/evidence"),
            candidate("https://x.test/clean", "https://x.test/clean"),
          ],
        };
      },
    };

    const result = await runPipeline({
      projectId: "00000000-0000-4000-8000-000000000001",
      ctx: emptyContext(),
      rules: [rule],
      deliveryLocale: "en",
      discrepancySubjectRefs: [
        "https://x.test/direct",
        "https://x.test/evidence",
      ],
    });

    const confidenceBySubject = Object.fromEntries(
      result.findings.map((finding) => [
        finding.subjectRefs[0],
        finding.confidence,
      ]),
    );
    expect(confidenceBySubject).toEqual({
      "https://x.test/direct": "medium",
      "http_status:404": "medium",
      "https://x.test/clean": "high",
    });
  });
});
