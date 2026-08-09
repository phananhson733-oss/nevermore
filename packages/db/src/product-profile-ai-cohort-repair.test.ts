import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  createProductProfileAiCohortRepairRuntime,
  parseProductProfileAiCohortRepairArguments,
  repairProductProfileAiCohort,
  runProductProfileAiCohortRepairCli,
  type ProductProfileAiCohortRepairCliDependencies,
  type ProductProfileAiCohortRepairDependencies,
} from "./product-profile-ai-cohort-repair.ts";

const ids = {
  workspace: "00000000-0000-4000-8000-000000000001",
  project: "00000000-0000-4000-8000-000000000002",
  profile: "00000000-0000-4000-8000-000000000003",
  site: "00000000-0000-4000-8000-000000000004",
  snapshot: "00000000-0000-4000-8000-000000000005",
  invocation: "00000000-0000-4000-8000-000000000006",
  audience: "00000000-0000-4000-8000-000000000007",
  competitor: "00000000-0000-4000-8000-000000000008",
} as const;

const contentHash = "a".repeat(64);

function validArguments(...extra: readonly string[]): string[] {
  return [
    "--workspace-id",
    ids.workspace,
    "--project-id",
    ids.project,
    "--expected-profile-id",
    ids.profile,
    "--expected-profile-version",
    "4",
    "--expected-content-hash",
    contentHash,
    ...extra,
  ];
}

const tracedPaths = [
  "/businessHint",
  "/productName",
  "/oneLiner",
  "/category",
  "/productType",
  "/businessModels",
  "/valueProposition",
  "/coreFeatures",
  "/targetMarkets",
  "/targetAudiences",
  "/competitorCandidates/0",
] as const;

function confirmedProfile(): Record<string, unknown> {
  return {
    profileSchemaVersion: "product-profile.0.3.0",
    sourceSiteId: ids.site,
    sourcePageUrl: "https://example.com/product",
    sourceSnapshotId: ids.snapshot,
    analysisInvocationId: ids.invocation,
    generatedAt: "2026-08-09T09:30:00.000Z",
    businessHint: "B2B workflow software",
    productName: "RelayOps",
    oneLiner: "Evidence-grounded customer onboarding operations",
    category: "Customer onboarding",
    productType: "B2B SaaS",
    businessModels: ["subscription"],
    valueProposition:
      "Help operations teams standardize customer onboarding.",
    coreFeatures: ["Workflow automation", "Implementation tracking"],
    targetMarkets: [{ marketCode: "US", priority: "primary" }],
    targetAudiences: [
      {
        candidateId: ids.audience,
        reviewStatus: "primary",
        targetCompanyOrAudience: "B2B SaaS companies",
        buyerRoles: ["VP Customer Success"],
        userRoles: ["Customer Operations Lead"],
        useCases: ["Standardize customer onboarding"],
        triggers: ["Onboarding volume increased"],
        pains: ["Manual handoffs"],
        jtbd: ["Reduce time to value"],
        outcomes: ["A repeatable onboarding process"],
        barriers: ["Fragmented tooling"],
        qualificationSignals: ["Owns onboarding operations"],
        disqualifiers: ["No onboarding workflow"],
      },
    ],
    competitorCandidates: [
      {
        candidateId: ids.competitor,
        name: "Userpilot",
        domain: "userpilot.com",
        relationship: "direct",
        analysisScope: ["positioning", "product_capability"],
        similarity: 0.82,
        reason: "Overlapping audience and workflow",
        reviewStatus: "approved",
        confidence: "medium",
      },
    ],
    fieldProvenance: tracedPaths.map((path, index) => ({
      path,
      derivation: "inferred",
      confidence: "medium",
      evidenceRefs: [
        {
          evidenceRefId: `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
          kind: "analysisInvocation",
          analysisInvocationId: ids.invocation,
        },
      ],
      limitation: null,
      observedAt: "2026-08-09T09:30:00.000Z",
    })),
    missingFields: [],
    conflictingFields: [],
  };
}

function repairHarness(overrides: {
  readonly confirmedProfileId?: string | null;
  readonly profile?: Record<string, unknown>;
  readonly profileRowId?: string;
  readonly profileVersion?: number;
  readonly profileStatus?: string;
  readonly profileContentHash?: string;
  readonly primarySites?: readonly {
    readonly id: string;
    readonly marketCodes: readonly string[];
    readonly languageCodes: readonly string[];
  }[];
  readonly existingQueryCount?: number;
} = {}) {
  const tx = {
    lockActiveProject: vi.fn().mockResolvedValue({
      confirmedProfileId: overrides.confirmedProfileId === undefined
        ? ids.profile
        : overrides.confirmedProfileId,
    }),
    findConfirmedProfile: vi.fn().mockResolvedValue({
      id: overrides.profileRowId ?? ids.profile,
      version: overrides.profileVersion ?? 4,
      status: overrides.profileStatus ?? "complete",
      profile: overrides.profile ?? confirmedProfile(),
      contentHash: overrides.profileContentHash ?? contentHash,
      createdAt: "2026-08-09T09:30:00.000Z",
    }),
    listPrimarySites: vi.fn().mockResolvedValue(
      overrides.primarySites ?? [
        {
          id: ids.site,
          marketCodes: ["US"],
          languageCodes: ["en-US"],
        },
      ],
    ),
    countGenerativeQueries: vi
      .fn()
      .mockResolvedValue(overrides.existingQueryCount ?? 0),
    bootstrapConfirmedProfileGenerativeQueries: vi.fn(),
  };
  const derivedQueries = Array.from({ length: 20 }, (_, index) => ({
    templateId: `template-${index + 1}`,
    displayKeyword: `private query ${index + 1}`,
    normalizedKeyword: `private query ${index + 1}`,
    sourceRef: `product_profile:${ids.profile}#profile-generative-query.v1/template-${index + 1}`,
  }));
  const dependencies: ProductProfileAiCohortRepairDependencies = {
    transaction: vi.fn(async (operation) => operation(tx)),
    deriveConfirmedProductProfileGenerativeQueries: vi
      .fn()
      .mockReturnValue({ status: "ready", queries: derivedQueries }),
  };
  return { dependencies, tx };
}

describe("parseProductProfileAiCohortRepairArguments", () => {
  it("defaults a fully explicit identity fence to dry-run", () => {
    expect(
      parseProductProfileAiCohortRepairArguments(validArguments()),
    ).toEqual({
      workspaceId: ids.workspace,
      projectId: ids.project,
      expectedProfileId: ids.profile,
      expectedProfileVersion: 4,
      expectedContentHash: contentHash,
      mode: "dry-run",
    });
  });

  it("enables writes only for the standalone --apply flag", () => {
    expect(
      parseProductProfileAiCohortRepairArguments(validArguments("--apply")),
    ).toMatchObject({ mode: "apply" });
  });

  it.each([
    ["missing required values", validArguments().slice(0, -2)],
    [
      "non-RFC UUID values",
      validArguments().with(1, "00000000-0000-0000-8000-000000000001"),
    ],
    [
      "non-SHA-256 content hashes",
      validArguments().with(9, `${"a".repeat(63)}g`),
    ],
    ["unsafe profile versions", validArguments().with(7, "9007199254740992")],
    [
      "unknown options",
      [...validArguments(), "--database-url", "postgres://operator:secret@db/prod"],
    ],
    [
      "duplicate options",
      [...validArguments(), "--project-id", ids.project],
    ],
    ["non-standalone apply values", [...validArguments(), "--apply=true"]],
  ])("rejects %s without echoing input", (_label, argv) => {
    expect(() => parseProductProfileAiCohortRepairArguments(argv)).toThrow(
      "Invalid Product Profile AI cohort repair arguments.",
    );
  });
});

describe("repairProductProfileAiCohort", () => {
  it("previews exactly 20 derived queries in dry-run without invoking a writer", async () => {
    const { dependencies, tx } = repairHarness();
    const options = parseProductProfileAiCohortRepairArguments(validArguments());

    const result = await repairProductProfileAiCohort(options, dependencies);

    expect(result).toEqual({
      workspaceId: ids.workspace,
      projectId: ids.project,
      profileId: ids.profile,
      profileVersion: 4,
      profileContentHash: contentHash,
      mode: "dry-run",
      status: "would_bootstrap",
      existingQueryCount: 0,
      derivedQueryCount: 20,
      bootstrappedQueryCount: 0,
    });
    expect(tx.bootstrapConfirmedProfileGenerativeQueries).not.toHaveBeenCalled();
    expect(dependencies.deriveConfirmedProductProfileGenerativeQueries).toHaveBeenCalledTimes(
      1,
    );
  });

  it("applies through the cohort repository exactly once", async () => {
    const { dependencies, tx } = repairHarness({
      primarySites: [
        { id: ids.site, marketCodes: ["US"], languageCodes: ["en-us"] },
      ],
    });
    tx.bootstrapConfirmedProfileGenerativeQueries.mockResolvedValue({
      status: "bootstrapped",
      existingQueryCount: 0,
      bootstrappedCount: 20,
      querySetHash: "b".repeat(64),
    });
    const options = parseProductProfileAiCohortRepairArguments(
      validArguments("--apply"),
    );

    const result = await repairProductProfileAiCohort(options, dependencies);

    expect(tx.bootstrapConfirmedProfileGenerativeQueries).toHaveBeenCalledTimes(
      1,
    );
    expect(tx.bootstrapConfirmedProfileGenerativeQueries).toHaveBeenCalledWith(
      { workspaceId: ids.workspace, projectId: ids.project },
      expect.objectContaining({
        confirmedProfileId: ids.profile,
        confirmedProfileVersion: 4,
        confirmedProfileContentHash: contentHash,
        marketCode: "US",
        languageTag: "en-US",
      }),
    );
    expect(result).toMatchObject({
      mode: "apply",
      status: "bootstrapped",
      existingQueryCount: 0,
      derivedQueryCount: 20,
      bootstrappedQueryCount: 20,
      querySetHash: "b".repeat(64),
    });
  });

  it.each([1, 19, 20, 21])(
    "returns a typed dry-run no-op when %i GenerativeQueries already exist",
    async (existingQueryCount) => {
      const { dependencies, tx } = repairHarness({ existingQueryCount });
      const options = parseProductProfileAiCohortRepairArguments(
        validArguments(),
      );

      const result = await repairProductProfileAiCohort(options, dependencies);

      expect(result).toMatchObject({
        status: "skipped_existing_queries",
        existingQueryCount,
        derivedQueryCount: 0,
        bootstrappedQueryCount: 0,
      });
      expect(
        dependencies.deriveConfirmedProductProfileGenerativeQueries,
      ).not.toHaveBeenCalled();
      expect(tx.bootstrapConfirmedProfileGenerativeQueries).not.toHaveBeenCalled();
    },
  );

  it("preserves the repository's typed apply no-op for an existing 19-row cohort", async () => {
    const { dependencies, tx } = repairHarness();
    tx.bootstrapConfirmedProfileGenerativeQueries.mockResolvedValue({
      status: "skipped_existing_queries",
      existingQueryCount: 19,
      bootstrappedCount: 0,
      querySetHash: null,
    });
    const options = parseProductProfileAiCohortRepairArguments(
      validArguments("--apply"),
    );

    const result = await repairProductProfileAiCohort(options, dependencies);

    expect(result).toMatchObject({
      mode: "apply",
      status: "skipped_existing_queries",
      existingQueryCount: 19,
      derivedQueryCount: 0,
      bootstrappedQueryCount: 0,
    });
    expect(result).not.toHaveProperty("querySetHash");
    expect(tx.bootstrapConfirmedProfileGenerativeQueries).toHaveBeenCalledTimes(
      1,
    );
    expect(tx.countGenerativeQueries).not.toHaveBeenCalled();
    expect(
      dependencies.deriveConfirmedProductProfileGenerativeQueries,
    ).not.toHaveBeenCalled();
  });

  it.each([
    [
      "confirmed pointer",
      { confirmedProfileId: "00000000-0000-4000-8000-000000000099" },
    ],
    [
      "profile id",
      { profileRowId: "00000000-0000-4000-8000-000000000099" },
    ],
    ["profile version", { profileVersion: 5 }],
    ["profile status", { profileStatus: "draft" }],
    ["profile content hash", { profileContentHash: "b".repeat(64) }],
  ])("fails closed on a %s identity mismatch", async (_label, overrides) => {
    const { dependencies, tx } = repairHarness(overrides);

    await expect(
      repairProductProfileAiCohort(
        parseProductProfileAiCohortRepairArguments(validArguments()),
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "PROFILE_IDENTITY_MISMATCH" });
    expect(tx.countGenerativeQueries).not.toHaveBeenCalled();
    expect(tx.bootstrapConfirmedProfileGenerativeQueries).not.toHaveBeenCalled();
  });

  it("strictly rejects a confirmed profile with an unknown field", async () => {
    const { dependencies, tx } = repairHarness({
      profile: {
        ...confirmedProfile(),
        secretProfilePayload: "must-never-be-logged",
      },
    });

    await expect(
      repairProductProfileAiCohort(
        parseProductProfileAiCohortRepairArguments(validArguments()),
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "PROFILE_CONTRACT_INVALID" });
    expect(tx.countGenerativeQueries).not.toHaveBeenCalled();
    expect(tx.bootstrapConfirmedProfileGenerativeQueries).not.toHaveBeenCalled();
  });

  it.each([
    ["missing primary Site", []],
    [
      "multiple primary Sites",
      [
        { id: ids.site, marketCodes: ["US"], languageCodes: ["en-US"] },
        {
          id: "00000000-0000-4000-8000-000000000009",
          marketCodes: ["US"],
          languageCodes: ["en-US"],
        },
      ],
    ],
    [
      "primary profile market missing from the Site",
      [{ id: ids.site, marketCodes: ["CA"], languageCodes: ["en-US"] }],
    ],
    [
      "case-shifted Site market that SQL authority would reject",
      [{ id: ids.site, marketCodes: ["us"], languageCodes: ["en-US"] }],
    ],
    [
      "multiple languages",
      [{ id: ids.site, marketCodes: ["US"], languageCodes: ["en-US", "zh-CN"] }],
    ],
    [
      "invalid market",
      [{ id: ids.site, marketCodes: ["USA"], languageCodes: ["en-US"] }],
    ],
    [
      "invalid language",
      [{ id: ids.site, marketCodes: ["US"], languageCodes: ["not_a_locale"] }],
    ],
    [
      "language alias that changes canonical BCP-47 identity",
      [{ id: ids.site, marketCodes: ["US"], languageCodes: ["iw-IL"] }],
    ],
  ])("fails closed on %s ambiguity", async (_label, primarySites) => {
    const { dependencies, tx } = repairHarness({ primarySites });

    await expect(
      repairProductProfileAiCohort(
        parseProductProfileAiCohortRepairArguments(validArguments()),
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "PRIMARY_SITE_CONTEXT_AMBIGUOUS" });
    expect(tx.countGenerativeQueries).not.toHaveBeenCalled();
    expect(tx.bootstrapConfirmedProfileGenerativeQueries).not.toHaveBeenCalled();
  });

  it("uses the strict profile's primary market when the Site has multiple markets", async () => {
    const { dependencies } = repairHarness({
      primarySites: [
        {
          id: ids.site,
          marketCodes: ["CA", "US"],
          languageCodes: ["en-US"],
        },
      ],
    });

    await expect(
      repairProductProfileAiCohort(
        parseProductProfileAiCohortRepairArguments(validArguments()),
        dependencies,
      ),
    ).resolves.toMatchObject({
      status: "would_bootstrap",
      derivedQueryCount: 20,
    });
    expect(
      dependencies.deriveConfirmedProductProfileGenerativeQueries,
    ).toHaveBeenCalledWith(expect.objectContaining({ marketCode: "US" }));
  });

  it("fails closed if a ready derivation does not contain exactly 20 queries", async () => {
    const { dependencies, tx } = repairHarness();
    const derive = vi.mocked(
      dependencies.deriveConfirmedProductProfileGenerativeQueries,
    );
    const ready = derive.getMockImplementation()?.({} as never);
    if (!ready || ready.status !== "ready") {
      throw new Error("test fixture must provide a ready derivation");
    }
    derive.mockReturnValue({ status: "ready", queries: ready.queries.slice(0, 19) });

    await expect(
      repairProductProfileAiCohort(
        parseProductProfileAiCohortRepairArguments(validArguments()),
        dependencies,
      ),
    ).rejects.toMatchObject({ code: "DERIVATION_INVARIANT_VIOLATION" });
    expect(tx.bootstrapConfirmedProfileGenerativeQueries).not.toHaveBeenCalled();
  });
});

describe("runProductProfileAiCohortRepairCli", () => {
  function cliHarness(
    repairDependencies: ProductProfileAiCohortRepairDependencies,
  ) {
    const stdout: string[] = [];
    const stderr: string[] = [];
    const close = vi.fn().mockResolvedValue(undefined);
    const createRuntime = vi.fn().mockReturnValue({
      repairDependencies,
      close,
    });
    const dependencies: ProductProfileAiCohortRepairCliDependencies = {
      createRuntime,
      writeStdout: (line) => stdout.push(line),
      writeStderr: (line) => stderr.push(line),
    };
    return { dependencies, stdout, stderr, close, createRuntime };
  }

  it("writes one metadata-only JSON result after a dry-run", async () => {
    const repair = repairHarness();
    const cli = cliHarness(repair.dependencies);
    const databaseUrl = "postgres://operator:super-secret@db.example.com/prod";

    await expect(
      runProductProfileAiCohortRepairCli(
        validArguments(),
        { DATABASE_URL: databaseUrl },
        cli.dependencies,
      ),
    ).resolves.toBe(0);

    expect(cli.stderr).toEqual([]);
    expect(cli.stdout).toHaveLength(1);
    expect(JSON.parse(cli.stdout[0] ?? "")).toEqual({
      workspaceId: ids.workspace,
      projectId: ids.project,
      profileId: ids.profile,
      profileVersion: 4,
      profileContentHash: contentHash,
      mode: "dry-run",
      status: "would_bootstrap",
      existingQueryCount: 0,
      derivedQueryCount: 20,
      bootstrappedQueryCount: 0,
    });
    expect(cli.stdout.join("\n")).not.toContain(databaseUrl);
    expect(cli.stdout.join("\n")).not.toContain("RelayOps");
    expect(cli.stdout.join("\n")).not.toContain("private query");
    expect(cli.close).toHaveBeenCalledTimes(1);
  });

  it("rejects an unknown secret-bearing argument without opening the database or leaking it", async () => {
    const repair = repairHarness();
    const cli = cliHarness(repair.dependencies);
    const secret = "postgres://operator:must-not-leak@db.example.com/prod";

    await expect(
      runProductProfileAiCohortRepairCli(
        [...validArguments(), "--database-url", secret],
        { DATABASE_URL: secret },
        cli.dependencies,
      ),
    ).resolves.toBe(1);

    expect(cli.createRuntime).not.toHaveBeenCalled();
    expect(cli.stdout).toEqual([]);
    expect(cli.stderr).toEqual([
      `${JSON.stringify({ status: "error", code: "INVALID_ARGUMENTS" })}\n`,
    ]);
    expect(cli.stderr.join("\n")).not.toContain(secret);
  });

  it("fails with a fixed code when DATABASE_URL is absent", async () => {
    const repair = repairHarness();
    const cli = cliHarness(repair.dependencies);

    await expect(
      runProductProfileAiCohortRepairCli(
        validArguments(),
        {},
        cli.dependencies,
      ),
    ).resolves.toBe(1);

    expect(cli.createRuntime).not.toHaveBeenCalled();
    expect(cli.stdout).toEqual([]);
    expect(cli.stderr).toEqual([
      `${JSON.stringify({ status: "error", code: "DATABASE_CONFIG_MISSING" })}\n`,
    ]);
  });

  it("redacts unexpected database failures from stderr", async () => {
    const secret = "postgres://operator:never-log-this@db.example.com/prod";
    const repair = repairHarness();
    vi.mocked(repair.dependencies.transaction).mockRejectedValue(
      new Error(`connection failed: ${secret}`),
    );
    const cli = cliHarness(repair.dependencies);

    await expect(
      runProductProfileAiCohortRepairCli(
        validArguments(),
        { DATABASE_URL: secret },
        cli.dependencies,
      ),
    ).resolves.toBe(1);

    expect(cli.stdout).toEqual([]);
    expect(cli.stderr).toEqual([
      `${JSON.stringify({ status: "error", code: "REPAIR_FAILED" })}\n`,
    ]);
    expect(cli.stderr.join("\n")).not.toContain(secret);
    expect(cli.close).toHaveBeenCalledTimes(1);
  });
});

describe("createProductProfileAiCohortRepairRuntime", () => {
  it("rejects a non-PostgreSQL DATABASE_URL without echoing it", () => {
    const secret = "https://operator:must-not-leak@db.example.com/prod";

    expect(() => createProductProfileAiCohortRepairRuntime(secret)).toThrow(
      expect.objectContaining({
        code: "DATABASE_CONFIG_INVALID",
        message: "Product Profile AI cohort repair failed.",
      }),
    );
  });
});

describe("operator package entry", () => {
  it("exposes one root-level tsx repair command", () => {
    const packageJson = JSON.parse(
      readFileSync(new URL("../../../package.json", import.meta.url), "utf8"),
    ) as { readonly scripts?: Readonly<Record<string, string>> };

    expect(packageJson.scripts?.["repair:product-profile-ai-cohort"]).toBe(
      "tsx packages/db/src/product-profile-ai-cohort-repair.ts",
    );
  });
});
