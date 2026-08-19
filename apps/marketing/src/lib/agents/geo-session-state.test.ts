// @input  -- a real finished run, plus every way a stored payload can be wrong
// @output -- proof restoration is same-tab, short-lived, hash-checked and fails closed
// @pos    -- focused tests for the only state this agent keeps between navigations

import { describe, expect, it } from "vitest";

import { confirmGeoContext, type GeoContextSnapshotV1 } from "./geo-context.ts";
import { buildGeoCoreQuerySet, confirmGeoQuerySet } from "./geo-questions.ts";
import type { GeoQuerySetV1 } from "./geo-query-contract.ts";
import type { GeoProviderObservation } from "./geo-provider.ts";
import type {
  GeoQuestionObservationV3,
  GeoReportDataV3,
} from "./geo-report-contract.ts";
import { deriveGeoRunCoverage } from "./geo-report-derive.ts";
import {
  assembleQuestion,
  observeToSample,
  type GeoSamplingContext,
} from "./geo-sampling.ts";
import {
  clearGeoReportSession,
  GEO_REPORT_SESSION_KEY,
  GEO_REPORT_SESSION_TTL_MS,
  restoreGeoReportSession,
  saveGeoReportSession,
  type GeoSessionStorage,
} from "./geo-session-state.ts";

const CLOCK = (): Date => new Date("2026-08-19T09:00:00.000Z");
const SAVED_AT = new Date("2026-08-19T09:10:00.000Z");

const SAMPLING: GeoSamplingContext = {
  targetHost: "acme.test",
  brandAliases: [{ alias: "Acme Analytics", source: "profile_product_name" }],
  aliasScope: "supported",
};

/** An in-memory store with the same three methods, and the same failure modes. */
function memoryStorage(
  initial: string | null = null,
): GeoSessionStorage & { readonly read: () => string | null } {
  let value = initial;
  return {
    getItem: (key) => (key === GEO_REPORT_SESSION_KEY ? value : null),
    setItem: (key, next) => {
      if (key === GEO_REPORT_SESSION_KEY) value = next;
    },
    removeItem: (key) => {
      if (key === GEO_REPORT_SESSION_KEY) value = null;
    },
    read: () => value,
  };
}

function observation(): GeoProviderObservation {
  return {
    observedAt: "2026-08-19T09:05:00.000Z",
    webSearchPerformed: true,
    answerText: "Several tools cover this.",
    citations: [
      {
        url: "https://rival.test/guide",
        title: null,
        annotationText: null,
        providerOutputItemIndex: 1,
        sectionIndex: 0,
        annotationOrdinal: 0,
        startIndex: null,
        endIndex: null,
        spanBasis: "provider_message_section_text",
      },
    ],
    citationsComplete: true,
    costUsd: 0.0457,
    model: "gpt-5-2025-08-07",
  };
}

async function finishedRun(): Promise<{
  readonly context: GeoContextSnapshotV1;
  readonly querySet: GeoQuerySetV1;
  readonly report: GeoReportDataV3;
}> {
  const confirmed = await confirmGeoContext(
    {
      targetUrl: "https://acme.test/pricing",
      productName: "Acme Analytics",
      brandAliases: [
        {
          alias: "Acme Analytics",
          source: "profile_product_name",
          confirmed: true,
        },
      ],
      category: "seo reporting",
      categoryConfirmed: true,
      buyer: "head of growth",
      user: "",
      jtbd: "",
      useCases: [],
      outcomes: [],
      barriers: [],
      directCompetitors: [],
      indirectAlternatives: [],
      marketCode: "US",
      targetQueryLanguage: "en",
      sourceProfileVersion: "geo-context.local.v1",
      sourceSummary: [
        { field: "category", source: "user_edit", limitationCode: null },
      ],
    },
    CLOCK,
  );
  if (!confirmed.ok) throw new Error(confirmed.rejections.join(","));
  const built = await buildGeoCoreQuerySet(confirmed.snapshot, CLOCK);
  if (!built.ok) throw new Error("fixture query set");
  const querySet = await confirmGeoQuerySet(built.querySet, CLOCK);

  const questions: GeoQuestionObservationV3[] = querySet.queries.map(
    (unit, index) =>
      assembleQuestion(
        unit,
        Array.from({ length: unit.samplesPlanned }, (_ignored, sample) =>
          observeToSample(
            {
              queryIndex: index,
              sampleIndex: sample + 1,
              sampleId: `${unit.queryId}-s${sample + 1}`,
            },
            unit,
            observation(),
            SAMPLING,
          ),
        ),
      ),
  );

  return {
    context: confirmed.snapshot,
    querySet,
    report: {
      run: {
        agent: "geo",
        mode: "authenticated_agent",
        persistence: "report_contents_not_persisted",
        schemaVersion: "agent_geo_report.v3",
        runId: "run-01",
        sampledAt: "2026-08-19T09:05:00.000Z",
        targetHost: confirmed.snapshot.targetHost,
        contextHash: confirmed.snapshot.contextHash,
        querySetContentHash: querySet.querySetContentHash,
        reportContentHash: `sha256:${"c".repeat(64)}`,
        provenance: {
          collector: "dataforseo",
          upstream: "openai",
          surface: "dataforseo_chat_gpt_llm_responses_api",
          searchModeRequested: "web_search_permitted",
          modelRequested: "gpt-5-2025-08-07",
          modelObserved: ["gpt-5-2025-08-07"],
          maxOutputTokensRequested: 4_096,
          webSearchCountryIsoCodeRequested: "US",
          calibrationMarket: "US",
          triggerCalibrationScope: "calibrated_market",
          queryLanguageTag: "en",
          retrievalSamplesPerProbe: 3,
          naturalDemandSamplesPerQuery: 1,
          knownCostUsdMicros: 822_600,
          costComplete: true,
          unknownCostSamples: 0,
        },
      },
      coverage: deriveGeoRunCoverage(questions),
      questions,
      limitations: [],
    } as GeoReportDataV3,
  };
}

describe("geo report session state", () => {
  it("restores exactly the run that was stored", async () => {
    const run = await finishedRun();
    const storage = memoryStorage();

    expect(saveGeoReportSession(storage, run, SAVED_AT)).toBe(true);
    const restored = restoreGeoReportSession(
      storage,
      new Date("2026-08-19T09:12:00.000Z"),
    );

    expect(restored?.report.run.runId).toBe("run-01");
    // The identity that makes the copy builder accept it must survive the trip.
    expect(restored?.querySet.querySetContentHash).toBe(
      run.querySet.querySetContentHash,
    );
    expect(restored?.context.contextHash).toBe(run.context.contextHash);
    expect(restored?.report.questions.map((q) => q.text)).toEqual(
      run.report.questions.map((q) => q.text),
    );
  });

  it("stores nothing an outside party could use", async () => {
    const run = await finishedRun();
    const storage = memoryStorage();
    saveGeoReportSession(storage, run, SAVED_AT);
    const stored = JSON.parse(storage.read() ?? "{}") as Record<
      string,
      unknown
    >;

    // Three keys plus the version and the clock, and nothing else. Auth state,
    // credentials, account ids and credits are absent by construction rather
    // than by a filter somebody has to remember to update.
    expect(Object.keys(stored).sort()).toEqual([
      "context",
      "querySet",
      "report",
      "savedAt",
      "schemaVersion",
    ]);
  });

  it("drops a report older than the window instead of presenting it as current", async () => {
    const run = await finishedRun();
    const storage = memoryStorage();
    saveGeoReportSession(storage, run, SAVED_AT);

    const justInside = new Date(SAVED_AT.getTime() + GEO_REPORT_SESSION_TTL_MS);
    expect(restoreGeoReportSession(storage, justInside)).not.toBeNull();

    const justOutside = new Date(
      SAVED_AT.getTime() + GEO_REPORT_SESSION_TTL_MS + 1,
    );
    expect(restoreGeoReportSession(storage, justOutside)).toBeNull();
    // And it is gone, so the next navigation does not re-parse it.
    expect(storage.read()).toBeNull();
  });

  it("drops a payload saved in the future", async () => {
    const run = await finishedRun();
    const storage = memoryStorage();
    saveGeoReportSession(storage, run, SAVED_AT);

    // A clock that moved backwards would otherwise pin a report open forever.
    expect(
      restoreGeoReportSession(storage, new Date("2026-08-19T08:00:00.000Z")),
    ).toBeNull();
  });

  it("refuses to store a context and report from different runs", async () => {
    const run = await finishedRun();
    const storage = memoryStorage();

    const mismatched = {
      ...run,
      report: {
        ...run.report,
        run: { ...run.report.run, contextHash: `sha256:${"9".repeat(64)}` },
      },
    };
    expect(saveGeoReportSession(storage, mismatched, SAVED_AT)).toBe(false);
    expect(storage.read()).toBeNull();
  });

  it("drops a stored payload whose query set no longer matches the report", async () => {
    const run = await finishedRun();
    const storage = memoryStorage();
    saveGeoReportSession(storage, run, SAVED_AT);

    // Rewritten in place, the way a stale tab or a tampered store would.
    const stored = JSON.parse(storage.read() ?? "{}") as {
      querySet: { querySetContentHash: string };
    };
    stored.querySet.querySetContentHash = `sha256:${"8".repeat(64)}`;
    storage.setItem(GEO_REPORT_SESSION_KEY, JSON.stringify(stored));

    expect(
      restoreGeoReportSession(storage, new Date("2026-08-19T09:12:00.000Z")),
    ).toBeNull();
    expect(storage.read()).toBeNull();
  });

  it("drops a report that would not pass the guard the server's own payload passed", async () => {
    const run = await finishedRun();
    const storage = memoryStorage();
    saveGeoReportSession(storage, run, SAVED_AT);

    const stored = JSON.parse(storage.read() ?? "{}") as {
      report: { coverage: { validProbes: number } };
    };
    // A count that disagrees with the samples beneath it: exactly what the
    // strict report guard exists to refuse, and restoration must refuse it too.
    stored.report.coverage.validProbes = 99;
    storage.setItem(GEO_REPORT_SESSION_KEY, JSON.stringify(stored));

    expect(
      restoreGeoReportSession(storage, new Date("2026-08-19T09:12:00.000Z")),
    ).toBeNull();
  });

  it.each([
    ["not json at all", "{oops"],
    ["a bare array", "[]"],
    ["a different schema version", '{"schemaVersion":"geo_report_session.v2"}'],
    ["no timestamp", '{"schemaVersion":"geo_report_session.v1"}'],
    [
      "an unparseable timestamp",
      '{"schemaVersion":"geo_report_session.v1","savedAt":"whenever"}',
    ],
  ])("drops %s", (_label, raw) => {
    const storage = memoryStorage(raw);

    expect(restoreGeoReportSession(storage, SAVED_AT)).toBeNull();
    expect(storage.read()).toBeNull();
  });

  it("returns nothing, and deletes nothing, when there was never an entry", () => {
    const removals: string[] = [];
    const storage: GeoSessionStorage = {
      getItem: () => null,
      setItem: () => undefined,
      removeItem: (key) => {
        removals.push(key);
      },
    };

    expect(restoreGeoReportSession(storage, SAVED_AT)).toBeNull();
    // An absent entry is not a broken one. Deleting on the empty path would
    // make every page load a write, and the name of this test would be a lie.
    expect(removals).toEqual([]);
  });

  it("survives a storage that refuses to be written to", async () => {
    const run = await finishedRun();
    const refusing: GeoSessionStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => undefined,
    };

    // Losing restoration is acceptable; throwing on the page that just spent
    // eighteen provider calls is not.
    expect(saveGeoReportSession(refusing, run, SAVED_AT)).toBe(false);
  });

  it("forgets the report when the visitor starts over", async () => {
    const run = await finishedRun();
    const storage = memoryStorage();
    saveGeoReportSession(storage, run, SAVED_AT);

    clearGeoReportSession(storage);

    expect(storage.read()).toBeNull();
    expect(restoreGeoReportSession(storage, SAVED_AT)).toBeNull();
  });
});
