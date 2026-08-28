// @input  -- authenticated and hostile POST bodies against a scripted provider
// @output -- proof nothing is billed before the request is fully validated
// @pos    -- focused tests for the GEO Agent's paid execution boundary

import { describe, expect, it, vi } from "vitest";

import {
  MARKETING_WEBSITE_PROFILE_VERSION,
  WEBSITE_PROFILE_REFERENCE_VERSION,
  emptyMarketingWebsiteProfile,
  type WebsiteProfileReferenceV1,
} from "../account-websites/contracts.ts";
import type { ResolvedWebsiteProfile } from "../account-websites/store.ts";
import {
  buildGeoContextSourceSummary,
  confirmGeoContext,
  type GeoContextInputV1,
  type GeoContextSnapshotV1,
} from "./geo-context.ts";
import {
  GeoProviderError,
  type GeoProviderClient,
  type GeoProviderObservation,
} from "./geo-provider.ts";
import {
  buildGeoCoreQuerySet,
  confirmGeoQuerySet,
} from "./geo-questions.ts";
import {
  GEO_PLANNED_CALLS_PER_RUN,
  type GeoQuerySetV1,
} from "./geo-query-contract.ts";
import {
  isGeoReportSuccessEnvelope,
  AGENT_GEO_REPORT_SCHEMA_VERSION,
} from "./geo-report-contract.ts";
import {
  handleGeoRunRequest,
  validateGeoRunInput,
  type GeoRunHandlerDependencies,
} from "./geo-run-handler.ts";

const CLOCK = (): Date => new Date("2026-08-18T09:00:00.000Z");
const USER_ID = "72f487cf-2ca9-4d27-9b79-b20ac250db91";

const WEBSITE_PROFILE_REFERENCE: WebsiteProfileReferenceV1 = {
  schemaVersion: WEBSITE_PROFILE_REFERENCE_VERSION,
  websiteId: "c80c5f1d-5a0e-4d14-a6a5-e75bc66ca4a6",
  snapshotId: "a53f4ddb-7cd6-42da-af53-88cc68b41987",
  snapshotRevision: 3,
  profileSchemaVersion: MARKETING_WEBSITE_PROFILE_VERSION,
  profileHash: "a".repeat(64),
};
const RESOLVED_HIDDEN_PROFILE = {
  user: "Growth and content leads",
  useCases: ["Track assistant citations", "Compare against rivals"],
  outcomes: ["Appear in assistant answers"],
  barriers: ["No visibility into assistant answers"],
  indirectAlternatives: ["Manual spot checks"],
} as const;

const REFERENCE_VISIBLE_SOURCE_SUMMARY = buildGeoContextSourceSummary({
  hasCompetitors: true,
  hasJtbd: false,
  aliasSources: ["profile_product_name"],
});
const REFERENCE_HIDDEN_SOURCE_SUMMARY = [
  {
    field: "user",
    source: "saved_website_profile",
    limitationCode: "pinned_snapshot",
  },
  {
    field: "use_cases",
    source: "saved_website_profile",
    limitationCode: "pinned_snapshot",
  },
  {
    field: "outcomes",
    source: "saved_website_profile",
    limitationCode: "pinned_snapshot",
  },
  {
    field: "barriers",
    source: "saved_website_profile",
    limitationCode: "pinned_snapshot",
  },
  {
    field: "indirect_alternatives",
    source: "saved_website_profile",
    limitationCode: "pinned_snapshot",
  },
] as const;

function referencedContextInput(
  overrides: Partial<GeoContextInputV1> = {},
): Partial<GeoContextInputV1> {
  return {
    ...RESOLVED_HIDDEN_PROFILE,
    sourceProfileVersion: MARKETING_WEBSITE_PROFILE_VERSION,
    sourceSummary: [
      ...REFERENCE_VISIBLE_SOURCE_SUMMARY,
      ...REFERENCE_HIDDEN_SOURCE_SUMMARY,
    ],
    websiteProfileReference: WEBSITE_PROFILE_REFERENCE,
    ...overrides,
  };
}

const CONTEXT_INPUT: GeoContextInputV1 = {
  targetUrl: "https://acme.test/",
  productName: "Acme Analytics",
  brandAliases: [
    { alias: "Acme Analytics", source: "profile_product_name", confirmed: true },
  ],
  category: "seo",
  categoryConfirmed: true,
  buyer: "ceo",
  user: "",
  jtbd: "",
  useCases: [],
  outcomes: [],
  barriers: [],
  directCompetitors: ["semrush"],
  indirectAlternatives: [],
  marketCode: "US",
  targetQueryLanguage: "en",
  sourceProfileVersion: "agent-profile.v3",
  sourceSummary: [
      { field: "category", source: "user_edit", limitationCode: null },
    ],
};

async function context(
  overrides: Partial<GeoContextInputV1> = {},
): Promise<GeoContextSnapshotV1> {
  const result = await confirmGeoContext(
    { ...CONTEXT_INPUT, ...overrides },
    CLOCK,
  );
  if (!result.ok) throw new Error(result.rejections.join(","));
  return result.snapshot;
}

async function querySet(snapshot: GeoContextSnapshotV1): Promise<GeoQuerySetV1> {
  const built = await buildGeoCoreQuerySet(snapshot, CLOCK);
  if (!built.ok) throw new Error(JSON.stringify(built.rejections));
  return confirmGeoQuerySet(built.querySet, CLOCK);
}

async function body(
  overrides: {
    readonly context?: Partial<GeoContextInputV1>;
    readonly patchQuerySet?: (set: GeoQuerySetV1) => GeoQuerySetV1;
    readonly schemaVersion?: string;
  } = {},
): Promise<Record<string, unknown>> {
  const snapshot = await context(overrides.context);
  const set = await querySet(snapshot);
  return {
    schemaVersion: overrides.schemaVersion ?? AGENT_GEO_REPORT_SCHEMA_VERSION,
    context: snapshot,
    querySet: overrides.patchQuerySet ? overrides.patchQuerySet(set) : set,
  };
}

function observation(
  overrides: Partial<GeoProviderObservation> = {},
): GeoProviderObservation {
  return {
    observedAt: "2026-08-17T09:21:39.000Z",
    webSearchPerformed: true,
    answerText: "Acme Analytics is one of several tools that cover this.",
    citations: [
      {
        url: "https://acme.test/pricing",
        title: "Acme pricing",
        annotationText: "([acme.test](https://acme.test/pricing))",
        providerOutputItemIndex: 1,
        sectionIndex: 0,
        annotationOrdinal: 0,
        startIndex: 0,
        endIndex: 4,
        spanBasis: "provider_message_section_text",
      },
    ],
    citationsComplete: true,
    costUsd: 0.0457,
    model: "gpt-5-2025-08-07",
    ...overrides,
  };
}

function dependencies(
  overrides: Partial<GeoRunHandlerDependencies> = {},
): GeoRunHandlerDependencies {
  const provider: GeoProviderClient = {
    observe: vi.fn(async () => Promise.resolve(observation())),
  };
  return {
    authenticate: async () =>
      Promise.resolve({
        status: "authenticated",
        userId: USER_ID,
        email: null,
        avatarUrl: null,
      } as const),
    resolveWebsiteProfileReference: async () =>
      Promise.resolve({ kind: "ok", value: resolvedWebsiteProfile() }),
    claimDailyBudget: async () =>
      Promise.resolve({ kind: "allowed", runsToday: 1 } as const),
    createProvider: () => provider,
    now: () => Date.parse("2026-08-18T09:05:00.000Z"),
    runId: () => "run-01",
    ...overrides,
  };
}

function resolvedWebsiteProfile(
  canonicalSiteKey = "acme.test",
): ResolvedWebsiteProfile {
  const savedProfile = {
    ...emptyMarketingWebsiteProfile(),
    productName: "PROFILE TEXT MUST NOT ENTER LOGS",
    ...RESOLVED_HIDDEN_PROFILE,
  };
  return {
    website: {
      websiteId: WEBSITE_PROFILE_REFERENCE.websiteId,
      origin: `https://${canonicalSiteKey}`,
      host: canonicalSiteKey,
      canonicalSiteKey,
      displayName: "Acme",
      isPrimary: true,
      profileState: "confirmed",
      confirmedSnapshotId: WEBSITE_PROFILE_REFERENCE.snapshotId,
      confirmedSnapshotRevision: WEBSITE_PROFILE_REFERENCE.snapshotRevision,
      confirmedAt: "2026-08-28T00:00:00.000Z",
      createdAt: "2026-08-27T00:00:00.000Z",
      updatedAt: "2026-08-28T00:00:00.000Z",
    },
    reference: WEBSITE_PROFILE_REFERENCE,
    profile: savedProfile,
  };
}

function post(payload: unknown): Request {
  return new Request("https://gengrowth.ai/api/agents/geo/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

describe("validateGeoRunInput", () => {
  it("accepts exactly eight confirmed core queries", async () => {
    const result = await validateGeoRunInput(await body());

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.input.paidQueries).toHaveLength(8);
  });

  it("refuses an unconfirmed query set", async () => {
    const snapshot = await context();
    const built = await buildGeoCoreQuerySet(snapshot, CLOCK);
    if (!built.ok) throw new Error("expected a set");
    const result = await validateGeoRunInput({
      schemaVersion: AGENT_GEO_REPORT_SCHEMA_VERSION,
      context: snapshot,
      querySet: built.querySet,
    });

    expect(result).toEqual({ ok: false, code: "geo_query_set_unconfirmed" });
  });

  it("recomputes the context fingerprint rather than trusting it", async () => {
    const payload = await body();
    const snapshot = payload.context as GeoContextSnapshotV1;
    const result = await validateGeoRunInput({
      ...payload,
      context: { ...snapshot, category: "something else" },
    });

    expect(result).toEqual({ ok: false, code: "geo_context_invalid" });
  });

  it("recomputes the query-set fingerprint rather than trusting it", async () => {
    const result = await validateGeoRunInput(
      await body({
        patchQuerySet: (set) => ({
          ...set,
          querySetContentHash: `sha256:${"0".repeat(64)}`,
        }),
      }),
    );

    expect(result).toEqual({ ok: false, code: "geo_query_set_mismatch" });
  });

  it("refuses a query set bound to a different context", async () => {
    const result = await validateGeoRunInput(
      await body({
        patchQuerySet: (set) => ({
          ...set,
          contextHash: `sha256:${"1".repeat(64)}`,
        }),
      }),
    );

    expect(result.ok).toBe(false);
  });

  it("refuses a target host that disagrees with the target URL", async () => {
    const payload = await body();
    const snapshot = payload.context as GeoContextSnapshotV1;
    const result = await validateGeoRunInput({
      ...payload,
      context: { ...snapshot, targetHost: "evil.test" },
    });

    expect(result).toEqual({ ok: false, code: "geo_context_invalid" });
  });

  it("refuses a market that disagrees between context and query set", async () => {
    const result = await validateGeoRunInput(
      await body({ patchQuerySet: (set) => ({ ...set, marketCode: "GB" }) }),
    );

    expect(result.ok).toBe(false);
  });

  it("never accepts a run whose market was never confirmed", async () => {
    // Confirmation itself refuses a missing market, so the paid path can never
    // see one — and there is no US fallback anywhere on the way.
    await expect(context({ marketCode: "" })).rejects.toThrow("market_missing");
    await expect(context({ marketCode: "EU" })).rejects.toThrow(
      "market_not_a_country",
    );
  });

  it("refuses a retrieval probe whose registry link went missing", async () => {
    const result = await validateGeoRunInput(
      await body({
        patchQuerySet: (set) => ({
          ...set,
          queries: set.queries.map((query) =>
            query.mode === "retrieval_probe"
              ? { ...query, templateId: "geo.made.up" }
              : query,
          ),
        }),
      }),
    );

    expect(result).toEqual({ ok: false, code: "geo_query_set_invalid" });
  });

  it("refuses an over-long final rendered prompt before anything is charged", async () => {
    const result = await validateGeoRunInput(
      await body({
        patchQuerySet: (set) => ({
          ...set,
          queries: set.queries.map((query, index) =>
            index === 1
              ? { ...query, text: "a".repeat(501), samplesPlanned: query.samplesPlanned }
              : query,
          ),
        }),
      }),
    );

    // The guard catches it first; either way nothing reaches the provider.
    expect(result.ok).toBe(false);
  });

  it("refuses a plan that does not sum to the advertised call count", async () => {
    const result = await validateGeoRunInput(
      await body({
        patchQuerySet: (set) => ({
          ...set,
          queries: set.queries.slice(0, 7),
        }),
      }),
    );

    expect(result.ok).toBe(false);
  });
});

describe("handleGeoRunRequest", () => {
  it("refuses an outdated client before touching the provider", async () => {
    const createProvider = vi.fn();
    const response = await handleGeoRunRequest(
      post(await body({ schemaVersion: "agent_geo_report.v2" })),
      dependencies({ createProvider }),
    );

    expect(response.status).toBe(409);
    expect(createProvider).not.toHaveBeenCalled();
  });

  it("claims no budget for an invalid request", async () => {
    const claimDailyBudget = vi.fn();
    const response = await handleGeoRunRequest(
      post({ schemaVersion: AGENT_GEO_REPORT_SCHEMA_VERSION }),
      dependencies({ claimDailyBudget }),
    );

    expect(response.status).toBe(400);
    expect(claimDailyBudget).not.toHaveBeenCalled();
  });

  it("requires a signed-in visitor before reading the body", async () => {
    const response = await handleGeoRunRequest(
      post(await body()),
      dependencies({
        authenticate: async () => Promise.resolve({ status: "unauthenticated" }),
      }),
    );

    expect(response.status).toBe(401);
  });

  it("does no website-store lookup when the context has no reference", async () => {
    const resolveWebsiteProfileReference = vi.fn();
    const response = await handleGeoRunRequest(
      post(await body()),
      dependencies({ resolveWebsiteProfileReference }),
    );

    expect(response.status).toBe(200);
    expect(resolveWebsiteProfileReference).not.toHaveBeenCalled();
  });

  it("resolves the exact reference for the authenticated user before provider or budget", async () => {
    const resolveWebsiteProfileReference = vi.fn(async () => ({
      kind: "ok" as const,
      value: resolvedWebsiteProfile(),
    }));
    const createProvider = vi.fn(() => ({
      observe: vi.fn(async () => Promise.resolve(observation())),
    }));
    const claimDailyBudget = vi.fn(async () => ({
      kind: "allowed" as const,
      runsToday: 1,
    }));
    const response = await handleGeoRunRequest(
      post(
        await body({
          context: referencedContextInput(),
        }),
      ),
      dependencies({
        resolveWebsiteProfileReference,
        createProvider,
        claimDailyBudget,
      }),
    );

    expect(response.status).toBe(200);
    expect(resolveWebsiteProfileReference).toHaveBeenCalledWith(
      USER_ID,
      WEBSITE_PROFILE_REFERENCE,
    );
    expect(resolveWebsiteProfileReference.mock.invocationCallOrder[0]).toBeLessThan(
      createProvider.mock.invocationCallOrder[0]!,
    );
    expect(resolveWebsiteProfileReference.mock.invocationCallOrder[0]).toBeLessThan(
      claimDailyBudget.mock.invocationCallOrder[0]!,
    );
  });

  it.each([
    ["user", { user: "Tampered user" }],
    ["use cases", { useCases: ["Tampered use case"] }],
    ["outcomes", { outcomes: ["Tampered outcome"] }],
    ["barriers", { barriers: ["Tampered barrier"] }],
    [
      "indirect alternatives",
      { indirectAlternatives: ["Tampered alternative"] },
    ],
    ["source profile version", { sourceProfileVersion: "agent-profile.v3" }],
  ] as const)(
    "rejects a referenced context whose pinned %s differ before provider or budget",
    async (_label, tampered) => {
      const resolveWebsiteProfileReference = vi.fn(async () => ({
        kind: "ok" as const,
        value: resolvedWebsiteProfile(),
      }));
      const createProvider = vi.fn();
      const claimDailyBudget = vi.fn();
      const response = await handleGeoRunRequest(
        post(
          await body({
            context: referencedContextInput(tampered),
          }),
        ),
        dependencies({
          resolveWebsiteProfileReference,
          createProvider,
          claimDailyBudget,
        }),
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({
        error: { code: "geo_website_profile_reference_invalid" },
      });
      expect(resolveWebsiteProfileReference).toHaveBeenCalledWith(
        USER_ID,
        WEBSITE_PROFILE_REFERENCE,
      );
      expect(createProvider).not.toHaveBeenCalled();
      expect(claimDailyBudget).not.toHaveBeenCalled();
    },
  );

  it("rejects pinned hidden provenance for a field absent from the exact projection", async () => {
    const resolved = resolvedWebsiteProfile();
    const createProvider = vi.fn();
    const claimDailyBudget = vi.fn();
    const response = await handleGeoRunRequest(
      post(
        await body({
          context: referencedContextInput({ user: "" }),
        }),
      ),
      dependencies({
        resolveWebsiteProfileReference: async () =>
          Promise.resolve({
            kind: "ok",
            value: {
              ...resolved,
              profile: { ...resolved.profile, user: "" },
            },
          }),
        createProvider,
        claimDailyBudget,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "geo_website_profile_reference_invalid" },
    });
    expect(createProvider).not.toHaveBeenCalled();
    expect(claimDailyBudget).not.toHaveBeenCalled();
  });

  it("rejects saved-profile provenance on a visible run-local overlay field", async () => {
    const sourceSummary = referencedContextInput().sourceSummary!.map((entry) =>
      entry.field === "product_name"
        ? {
            ...entry,
            source: "saved_website_profile",
            limitationCode: "pinned_snapshot",
          }
        : entry,
    );
    const createProvider = vi.fn();
    const claimDailyBudget = vi.fn();
    const response = await handleGeoRunRequest(
      post(
        await body({
          context: referencedContextInput({ sourceSummary }),
        }),
      ),
      dependencies({ createProvider, claimDailyBudget }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "geo_website_profile_reference_invalid" },
    });
    expect(createProvider).not.toHaveBeenCalled();
    expect(claimDailyBudget).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", { kind: "missing" as const }],
    ["invalid", { kind: "invalid" as const, code: "invalid_reference" }],
  ])("rejects a %s exact reference before provider creation or billing", async (_label, outcome) => {
    const createProvider = vi.fn();
    const claimDailyBudget = vi.fn();
    const response = await handleGeoRunRequest(
      post(
        await body({
          context: referencedContextInput(),
        }),
      ),
      dependencies({
        resolveWebsiteProfileReference: async () => Promise.resolve(outcome),
        createProvider,
        claimDailyBudget,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "geo_website_profile_reference_invalid" },
    });
    expect(createProvider).not.toHaveBeenCalled();
    expect(claimDailyBudget).not.toHaveBeenCalled();
  });

  it("rejects a resolved website whose canonical key differs from the GEO target", async () => {
    const createProvider = vi.fn();
    const claimDailyBudget = vi.fn();
    const response = await handleGeoRunRequest(
      post(
        await body({
          context: referencedContextInput(),
        }),
      ),
      dependencies({
        resolveWebsiteProfileReference: async () =>
          Promise.resolve({
            kind: "ok",
            value: resolvedWebsiteProfile("other.test"),
          }),
        createProvider,
        claimDailyBudget,
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "geo_website_profile_reference_invalid" },
    });
    expect(createProvider).not.toHaveBeenCalled();
    expect(claimDailyBudget).not.toHaveBeenCalled();
  });

  it("returns profile-store unavailability distinctly before provider creation or billing", async () => {
    const createProvider = vi.fn();
    const claimDailyBudget = vi.fn();
    const response = await handleGeoRunRequest(
      post(
        await body({
          context: referencedContextInput(),
        }),
      ),
      dependencies({
        resolveWebsiteProfileReference: async () =>
          Promise.resolve({ kind: "unavailable", reason: "store_unavailable" }),
        createProvider,
        claimDailyBudget,
      }),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: { code: "geo_website_profile_unavailable" },
    });
    expect(createProvider).not.toHaveBeenCalled();
    expect(claimDailyBudget).not.toHaveBeenCalled();
  });

  it("never writes resolved website profile text to the run log", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const response = await handleGeoRunRequest(
      post(
        await body({
          context: referencedContextInput(),
        }),
      ),
      dependencies(),
    );

    expect(response.status).toBe(200);
    expect(JSON.stringify(info.mock.calls)).not.toContain(
      "PROFILE TEXT MUST NOT ENTER LOGS",
    );
    info.mockRestore();
  });

  it("issues exactly the planned number of provider calls", async () => {
    const observe = vi.fn(async () => Promise.resolve(observation()));
    const response = await handleGeoRunRequest(
      post(await body()),
      dependencies({ createProvider: () => ({ observe }) }),
    );

    expect(response.status).toBe(200);
    expect(observe).toHaveBeenCalledTimes(GEO_PLANNED_CALLS_PER_RUN);
    expect(observe).toHaveBeenCalledTimes(18);
  });

  it("respects each question's own sample count", async () => {
    const observe = vi.fn(async () => Promise.resolve(observation()));
    const response = await handleGeoRunRequest(
      post(await body()),
      dependencies({ createProvider: () => ({ observe }) }),
    );
    const envelope = (await response.json()) as {
      readonly data: { readonly questions: readonly { readonly mode: string; readonly samples: readonly unknown[] }[] };
    };

    const retrieval = envelope.data.questions.filter(
      (question) => question.mode === "retrieval_probe",
    );
    const natural = envelope.data.questions.filter(
      (question) => question.mode === "natural_demand",
    );
    expect(retrieval).toHaveLength(5);
    expect(natural).toHaveLength(3);
    expect(retrieval.every((question) => question.samples.length === 3)).toBe(true);
    expect(natural.every((question) => question.samples.length === 1)).toBe(true);
  });

  it("returns an envelope the browser's own guard accepts", async () => {
    const response = await handleGeoRunRequest(post(await body()), dependencies());
    const envelope: unknown = await response.json();

    expect(isGeoReportSuccessEnvelope(envelope)).toBe(true);
  });

  it("never serializes the provider's answer prose", async () => {
    const secret = "PROVIDER PROSE THAT MUST NOT TRAVEL";
    const observe = vi.fn(async () =>
      Promise.resolve(observation({ answerText: `Acme Analytics. ${secret}` })),
    );
    const response = await handleGeoRunRequest(
      post(await body()),
      dependencies({ createProvider: () => ({ observe }) }),
    );

    expect(await response.text()).not.toContain(secret);
  });

  it("keeps the response out of every cache", async () => {
    const response = await handleGeoRunRequest(post(await body()), dependencies());

    expect(response.headers.get("Cache-Control")).toBe("no-store, private");
  });

  // Regression: the label is taken verbatim from the provider and the report
  // contract accepts it only normalized, so one stray space would refuse a run
  // that had already been billed. Found by cross-model review on 2026-08-18.
  it("normalizes observed model labels before they reach provenance", async () => {
    const observe = vi.fn(async () => observation({ model: "  gpt-5-mini \n" }));
    const response = await handleGeoRunRequest(
      post(await body()),
      dependencies({ createProvider: () => ({ observe }) }),
    );
    const envelope = (await response.json()) as {
      readonly data: {
        readonly run: {
          readonly provenance: { readonly modelObserved: readonly string[] };
        };
      };
    };

    expect(response.status).toBe(200);
    expect(envelope.data.run.provenance.modelObserved).toEqual(["gpt-5-mini"]);
  });

  // Same class as the citation strings: NFC leaves an unpaired surrogate in
  // place and the fingerprint refuses to serialize it, so the run answered 502
  // after the calls were billed. Found by cross-model review on 2026-08-18.
  it("does not let an unbroken model label void the paid report", async () => {
    const observe = vi.fn(async () =>
      observation({ model: "gpt-5-mini\uD800" }),
    );
    const response = await handleGeoRunRequest(
      post(await body()),
      dependencies({ createProvider: () => ({ observe }) }),
    );
    const envelope = (await response.json()) as {
      readonly data: {
        readonly run: {
          readonly provenance: { readonly modelObserved: readonly string[] };
        };
      };
    };

    expect(response.status).toBe(200);
    expect(envelope.data.run.provenance.modelObserved).toEqual([]);
  });

  it("reports observed model labels deduped and deterministically sorted", async () => {
    let call = 0;
    const observe = vi.fn(async () => {
      call += 1;
      return observation({
        model: call % 2 === 0 ? "gpt-5-mini" : "gpt-5-2025-08-07",
      });
    });
    const response = await handleGeoRunRequest(
      post(await body()),
      dependencies({ createProvider: () => ({ observe }) }),
    );
    const envelope = (await response.json()) as {
      readonly data: { readonly run: { readonly provenance: { readonly modelObserved: readonly string[] } } };
    };

    expect(envelope.data.run.provenance.modelObserved).toEqual([
      "gpt-5-2025-08-07",
      "gpt-5-mini",
    ]);
  });

  it("accumulates cost as integer micros and says when it is incomplete", async () => {
    let call = 0;
    const observe = vi.fn(async () => {
      call += 1;
      return observation({ costUsd: call === 1 ? null : 0.0457 });
    });
    const response = await handleGeoRunRequest(
      post(await body()),
      dependencies({ createProvider: () => ({ observe }) }),
    );
    const envelope = (await response.json()) as {
      readonly data: {
        readonly run: {
          readonly provenance: {
            readonly knownCostUsdMicros: number;
            readonly costComplete: boolean;
            readonly unknownCostSamples: number;
          };
        };
      };
    };
    const { provenance } = envelope.data.run;

    expect(Number.isSafeInteger(provenance.knownCostUsdMicros)).toBe(true);
    // The unpriced call is counted as unpriced, never summed as a zero.
    expect(provenance.knownCostUsdMicros).toBe(45_700 * 17);
    expect(provenance.costComplete).toBe(false);
    expect(provenance.unknownCostSamples).toBe(1);
  });

  it("degrades to a partial report rather than discarding paid answers", async () => {
    let call = 0;
    const observe = vi.fn(async () => {
      call += 1;
      if (call <= 3) throw new GeoProviderError("server_error", "boom", 0.01);
      return observation();
    });
    const response = await handleGeoRunRequest(
      post(await body()),
      dependencies({ createProvider: () => ({ observe }) }),
    );
    const envelope = (await response.json()) as {
      readonly data: {
        readonly coverage: {
          readonly totals: {
            readonly answeredSamples: number;
            readonly unavailableSamples: number;
          };
        };
        readonly limitations: readonly string[];
      };
    };

    expect(response.status).toBe(200);
    expect(envelope.data.coverage.totals.answeredSamples).toBe(15);
    expect(envelope.data.coverage.totals.unavailableSamples).toBe(3);
    expect(envelope.data.limitations).toContain("partial_run");
  });

  it("marks a run degraded when a retrieval probe never searched", async () => {
    const observe = vi.fn(async () =>
      Promise.resolve(observation({ webSearchPerformed: false, citations: [] })),
    );
    const response = await handleGeoRunRequest(
      post(await body()),
      dependencies({ createProvider: () => ({ observe }) }),
    );
    const envelope = (await response.json()) as {
      readonly data: {
        readonly coverage: { readonly triggerFailedProbes: number };
        readonly limitations: readonly string[];
      };
    };

    expect(envelope.data.coverage.triggerFailedProbes).toBe(5);
    expect(envelope.data.limitations).toContain("degraded_retrieval_trigger");
  });

  it("says a non-US market sits outside the calibration", async () => {
    const response = await handleGeoRunRequest(
      post(await body({ context: { marketCode: "GB" } })),
      dependencies(),
    );
    const envelope = (await response.json()) as {
      readonly data: {
        readonly run: { readonly provenance: { readonly triggerCalibrationScope: string } };
        readonly limitations: readonly string[];
      };
    };

    expect(envelope.data.run.provenance.triggerCalibrationScope).toBe(
      "outside_calibrated_market",
    );
    expect(envelope.data.limitations).toContain("outside_calibrated_market");
  });

  it("refuses the run when the daily account budget is spent", async () => {
    const createProvider = vi.fn(() => ({
      observe: vi.fn(async () => Promise.resolve(observation())),
    }));
    const response = await handleGeoRunRequest(
      post(await body()),
      dependencies({
        createProvider,
        claimDailyBudget: async () =>
          Promise.resolve({ kind: "exhausted", retryAfterSeconds: 60 } as const),
      }),
    );

    expect(response.status).toBe(429);
  });

  it("binds the report to the context and query set it was run from", async () => {
    const payload = await body();
    const response = await handleGeoRunRequest(post(payload), dependencies());
    const envelope = (await response.json()) as {
      readonly data: { readonly run: { readonly contextHash: string; readonly querySetContentHash: string } };
    };

    expect(envelope.data.run.contextHash).toBe(
      (payload.context as GeoContextSnapshotV1).contextHash,
    );
    expect(envelope.data.run.querySetContentHash).toBe(
      (payload.querySet as GeoQuerySetV1).querySetContentHash,
    );
  });
});
