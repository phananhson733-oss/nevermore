import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import {
  createProductProfileAiCohortRepairRuntime,
  repairProductProfileAiCohort,
} from "../product-profile-ai-cohort-repair.ts";
import {
  KeywordOccurrencesRepository,
  type ProductProfileKeywordOccurrenceInput,
} from "../repositories/keyword-occurrences.ts";
import { KeywordsRepository } from "../repositories/keywords.ts";
import { requireSafeTestDatabaseUrl } from "../test-database-safety.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;
const PROFILE_CREATED_AT = "2026-08-09T09:30:00.000Z";
const UNCONFIRMED_PROFILE_CREATED_AT = "2026-08-09T09:31:00.000Z";

const TEMPLATE_IDS = [
  "what-is-product",
  "product-pricing",
  "product-reviews",
  "product-alternatives",
  "best-category",
  "best-category-audience",
  "best-type-audience",
  "buyer-use-case",
  "user-use-case",
  "how-to-jtbd",
  "how-to-use-case",
  "pain-solution",
  "trigger-process",
  "feature-software-1",
  "feature-workflow-2",
  "value-proposition",
  "category-comparison",
  "product-implementation",
  "compare-approved-competitor-1",
  "compare-approved-competitor-2",
] as const;

interface ProductProfileFixture {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly profileId: string;
  readonly unconfirmedProfileId: string;
  readonly workingDraftProfileId: string;
}

interface ProductProfileFixtureOptions {
  readonly languageCode?: string;
  readonly marketCodes?: readonly string[];
  readonly repairReadyProfile?: boolean;
}

interface RawKeywordOccurrenceInput {
  readonly occurrenceId: string | null;
  readonly dataSnapshotId: string | null;
  readonly observationId: string | null;
  readonly productProfileId: string | null;
  readonly displayKeyword: string;
  readonly normalizedKeyword: string;
  readonly market: string;
  readonly languageTag: string;
  readonly queryKind: string;
  readonly sourceKind: string;
  readonly scopeBasis: string;
  readonly sourcePointer: string | null;
  readonly sourceRef: string;
  readonly collectedAt: string;
  readonly providerDataAsOf: string | null;
}

function pgCode(error: unknown): string | undefined {
  let candidate = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return undefined;
    const wrapped = candidate as { code?: unknown; cause?: unknown };
    if (typeof wrapped.code === "string") return wrapped.code;
    candidate = wrapped.cause;
  }
  return undefined;
}

async function expectPgCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => pgCode(error) === code,
  );
}

function repairReadyProfile(siteId: string): Record<string, unknown> {
  const paths = [
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
  ] as const;
  return {
    profileSchemaVersion: "product-profile.0.3.0",
    sourceSiteId: siteId,
    sourcePageUrl: "https://example.com/product",
    sourceSnapshotId: null,
    analysisInvocationId: null,
    generatedAt: null,
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
        candidateId: randomUUID(),
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
    competitorCandidates: [],
    fieldProvenance: paths.map((path) => ({
      path,
      derivation: "declared",
      confidence: "medium",
      evidenceRefs: [{ evidenceRefId: randomUUID(), kind: "userEdit" }],
      limitation: "Declared fixture authority; not independently observed.",
      observedAt: null,
    })),
    missingFields: ["/competitorCandidates"],
    conflictingFields: [],
  };
}

async function createFixture(
  handle: DbHandle,
  options: ProductProfileFixtureOptions = {},
): Promise<ProductProfileFixture> {
  const workspaceId = randomUUID();
  const projectId = randomUUID();
  const siteId = randomUUID();
  const actorId = randomUUID();
  const profileId = randomUUID();
  const unconfirmedProfileId = randomUUID();
  const workingDraftProfileId = randomUUID();
  const host = `${projectId}.profile-keyword.example`;
  const confirmedProfile = options.repairReadyProfile
    ? repairReadyProfile(siteId)
    : {
        targetMarkets: [
          { marketCode: "US", priority: "primary" },
          { marketCode: "CA", priority: "secondary" },
        ],
      };

  await handle.pool.query(
    "INSERT INTO app.workspaces (id, name) VALUES ($1, $2)",
    [workspaceId, `Product Profile keyword ${workspaceId}`],
  );
  await handle.pool.query(
    `INSERT INTO app.client_projects (
       id, workspace_id, client_name, project_name,
       default_delivery_locale, created_by
     ) VALUES ($1,$2,$3,$4,'en-US',$5)`,
    [
      projectId,
      workspaceId,
      `Client ${projectId}`,
      `Project ${projectId}`,
      actorId,
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.sites (
       id, workspace_id, project_id, origin, host,
       market_codes, language_codes, is_primary
     ) VALUES ($1,$2,$3,$4,$5,$7::text[],ARRAY[$6::text],true)`,
    [
      siteId,
      workspaceId,
      projectId,
      `https://${host}`,
      host,
      options.languageCode ?? "en-US",
      options.marketCodes ?? ["US", "CA"],
    ],
  );
  await handle.pool.query(
    `INSERT INTO app.icp_profiles (
       id, workspace_id, project_id, version, status, profile,
       content_hash, created_by, created_at
     ) VALUES
       ($1,$4,$5,1,'complete',$9::jsonb,repeat('a',64),$6,$7),
       ($2,$4,$5,2,'complete',
        '{"targetMarkets":[{"marketCode":"US","priority":"primary"},{"marketCode":"CA","priority":"secondary"}]}'::jsonb,
        repeat('b',64),$6,$8),
       ($3,$4,$5,3,'draft',
        '{"targetMarkets":[{"marketCode":"US","priority":"primary"},{"marketCode":"CA","priority":"secondary"}]}'::jsonb,
        repeat('c',64),$6,$8)`,
    [
      profileId,
      unconfirmedProfileId,
      workingDraftProfileId,
      workspaceId,
      projectId,
      actorId,
      PROFILE_CREATED_AT,
      UNCONFIRMED_PROFILE_CREATED_AT,
      JSON.stringify(confirmedProfile),
    ],
  );
  await handle.pool.query(
    `UPDATE app.client_projects
        SET confirmed_icp_profile_id = $1,
            current_icp_profile_id = $2
      WHERE workspace_id = $3 AND id = $4`,
    [profileId, workingDraftProfileId, workspaceId, projectId],
  );

  return {
    workspaceId,
    projectId,
    profileId,
    unconfirmedProfileId,
    workingDraftProfileId,
  };
}

function productInputs(
  fixture: ProductProfileFixture,
): ProductProfileKeywordOccurrenceInput[] {
  return TEMPLATE_IDS.map((templateId, index) => ({
    manualEntryId: null,
    dataSnapshotId: null,
    normalizedObservationId: null,
    productProfileId: fixture.profileId,
    displayKeyword: `Product profile question ${index + 1}`,
    normalizedKeyword: `product profile question ${index + 1}`,
    market: "US",
    languageTag: "en-US",
    queryKind: "generative_query",
    sourceKind: "product_profile",
    scopeBasis: "project_context",
    sourcePointer: null,
    sourceRef:
      `product_profile:${fixture.profileId}#profile-generative-query.v1/${templateId}`,
    collectedAt: PROFILE_CREATED_AT,
    providerDataAsOf: null,
  }));
}

function rawInput(
  input: ProductProfileKeywordOccurrenceInput,
): RawKeywordOccurrenceInput {
  return {
    occurrenceId: input.manualEntryId,
    dataSnapshotId: input.dataSnapshotId,
    observationId: input.normalizedObservationId,
    productProfileId: input.productProfileId,
    displayKeyword: input.displayKeyword,
    normalizedKeyword: input.normalizedKeyword,
    market: input.market,
    languageTag: input.languageTag,
    queryKind: input.queryKind,
    sourceKind: input.sourceKind,
    scopeBasis: input.scopeBasis,
    sourcePointer: input.sourcePointer,
    sourceRef: input.sourceRef,
    collectedAt: input.collectedAt,
    providerDataAsOf: input.providerDataAsOf,
  };
}

async function callRawBatch(
  handle: DbHandle,
  fixture: ProductProfileFixture,
  inputs: readonly unknown[],
): Promise<unknown> {
  return handle.pool.query(
    `SELECT input_ordinal, occurrence_id, entity_id
       FROM app.upsert_keyword_library_occurrences_batch(
         $1::uuid,
         $2::uuid,
         $3::jsonb
       )
      ORDER BY input_ordinal`,
    [fixture.workspaceId, fixture.projectId, JSON.stringify(inputs)],
  );
}

async function occurrenceCount(
  handle: DbHandle,
  fixture: ProductProfileFixture,
): Promise<string> {
  const result = await handle.pool.query<{ count: string }>(
    `SELECT count(*)::text AS count
       FROM app.keyword_occurrences
      WHERE workspace_id = $1 AND project_id = $2`,
    [fixture.workspaceId, fixture.projectId],
  );
  return result.rows[0]!.count;
}

describeDb("Product Profile Keyword Library lineage", () => {
  let handle: DbHandle;

  beforeAll(() => {
    handle = createDbHandle(requireSafeTestDatabaseUrl(DATABASE_URL));
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("atomically writes the fixed 20 cohort, reads the profile FK and replays idempotently", async () => {
    const fixture = await createFixture(handle);
    const scope = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
    };
    let executeCount = 0;
    const executor = {
      execute(query: unknown) {
        executeCount += 1;
        return handle.db.execute(query as never);
      },
      select: handle.db.select.bind(handle.db),
    };
    const repository = new KeywordOccurrencesRepository(executor as never);
    const inputs = productInputs(fixture);

    const created = await repository.upsertManyIntoLibrary(scope, inputs);
    expect(created).toHaveLength(20);
    expect(executeCount).toBe(1);
    executeCount = 0;
    await expect(
      repository.upsertManyIntoLibrary(scope, inputs),
    ).resolves.toEqual(created);
    expect(executeCount).toBe(1);

    const stored = await handle.pool.query<{
      product_profile_id: string;
      occurrences: string;
      data_snapshots: string;
      observations: string;
      pointers: string;
      provider_timestamps: string;
    }>(
      `SELECT
         min(product_profile_id::text) AS product_profile_id,
         count(*)::text AS occurrences,
         count(data_snapshot_id)::text AS data_snapshots,
         count(normalized_observation_id)::text AS observations,
         count(source_pointer)::text AS pointers,
         count(provider_data_as_of)::text AS provider_timestamps
       FROM app.keyword_occurrences
       WHERE workspace_id = $1 AND project_id = $2`,
      [fixture.workspaceId, fixture.projectId],
    );
    expect(stored.rows).toEqual([
      {
        product_profile_id: fixture.profileId,
        occurrences: "20",
        data_snapshots: "0",
        observations: "0",
        pointers: "0",
        provider_timestamps: "0",
      },
    ]);
    await expect(
      new KeywordsRepository(handle.db).countBySourceKind(scope),
    ).resolves.toEqual({
      all: 20,
      csv_import: 0,
      dataforseo_ranked: 0,
      gsc_top_query: 0,
      product_profile: 20,
      interview_summary: 0,
      user_review: 0,
      manual: 0,
    });

    const page = await repository.listForEntity(scope, created[0]!.entityId, {
      limit: 20,
      cursor: null,
    });
    expect(page.rows[0]).toMatchObject({
      product_profile_id: fixture.profileId,
      source_kind: "product_profile",
    });
    await expect(
      repository.listForEntityIds(
        scope,
        created.slice(0, 2).map((row) => row.entityId),
        { limitPerEntity: 1, totalLimit: 2 },
      ),
    ).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ product_profile_id: fixture.profileId }),
      ]),
    );

    const functions = await handle.pool.query<{
      proname: string;
      pronargs: number;
    }>(
      `SELECT routine.proname, routine.pronargs
         FROM pg_proc routine
         JOIN pg_namespace namespace ON namespace.oid = routine.pronamespace
        WHERE namespace.nspname = 'app'
          AND routine.proname IN (
            'upsert_keyword_library_occurrence',
            'upsert_keyword_library_occurrences_batch'
          )
        ORDER BY routine.proname, routine.pronargs`,
    );
    expect(functions.rows).toEqual([
      { proname: "upsert_keyword_library_occurrence", pronargs: 17 },
      { proname: "upsert_keyword_library_occurrences_batch", pronargs: 3 },
    ]);

    const foreignKey = await handle.pool.query<{ delete_action: string }>(
      `SELECT constraint_row.confdeltype AS delete_action
         FROM pg_constraint constraint_row
        WHERE constraint_row.conrelid = 'app.keyword_occurrences'::regclass
          AND constraint_row.confrelid = 'app.icp_profiles'::regclass
          AND constraint_row.conname = 'keyword_occurrences_product_profile_fk'`,
    );
    expect(foreignKey.rows).toEqual([{ delete_action: "r" }]);

    await expectPgCode(
      handle.pool.query(
        "UPDATE app.keyword_occurrences SET display_keyword = 'changed' WHERE id = $1",
        [created[0]!.occurrenceId],
      ),
      "55000",
    );
    await expectPgCode(
      handle.pool.query(
        "DELETE FROM app.keyword_occurrences WHERE id = $1",
        [created[0]!.occurrenceId],
      ),
      "55000",
    );
  });

  it("keeps repair dry-run and apply consistent for a historical Site language spelling", async () => {
    const fixture = await createFixture(handle, {
      languageCode: "en-us",
      repairReadyProfile: true,
    });
    const databaseUrl = requireSafeTestDatabaseUrl(DATABASE_URL);
    const runtime = createProductProfileAiCohortRepairRuntime(databaseUrl);
    const identity = {
      workspaceId: fixture.workspaceId,
      projectId: fixture.projectId,
      expectedProfileId: fixture.profileId,
      expectedProfileVersion: 1,
      expectedContentHash: "a".repeat(64),
    } as const;

    try {
      await expect(
        repairProductProfileAiCohort(
          { ...identity, mode: "dry-run" },
          runtime.repairDependencies,
        ),
      ).resolves.toMatchObject({
        status: "would_bootstrap",
        derivedQueryCount: 20,
        bootstrappedQueryCount: 0,
      });
      await expect(
        repairProductProfileAiCohort(
          { ...identity, mode: "apply" },
          runtime.repairDependencies,
        ),
      ).resolves.toMatchObject({
        status: "bootstrapped",
        derivedQueryCount: 20,
        bootstrappedQueryCount: 20,
      });
    } finally {
      await runtime.close();
    }

    const stored = await handle.pool.query<{ language_tag: string }>(
      `SELECT DISTINCT language_tag
         FROM app.keyword_occurrences
        WHERE workspace_id = $1 AND project_id = $2`,
      [fixture.workspaceId, fixture.projectId],
    );
    expect(stored.rows).toEqual([{ language_tag: "en-US" }]);
  });

  it("fails repair dry-run closed when historical Site market casing differs from SQL authority", async () => {
    const fixture = await createFixture(handle, {
      languageCode: "en-us",
      marketCodes: ["us"],
      repairReadyProfile: true,
    });
    const runtime = createProductProfileAiCohortRepairRuntime(
      requireSafeTestDatabaseUrl(DATABASE_URL),
    );

    try {
      await expect(
        repairProductProfileAiCohort(
          {
            workspaceId: fixture.workspaceId,
            projectId: fixture.projectId,
            expectedProfileId: fixture.profileId,
            expectedProfileVersion: 1,
            expectedContentHash: "a".repeat(64),
            mode: "dry-run",
          },
          runtime.repairDependencies,
        ),
      ).rejects.toMatchObject({ code: "PRIMARY_SITE_CONTEXT_AMBIGUOUS" });
    } finally {
      await runtime.close();
    }

    await expect(occurrenceCount(handle, fixture)).resolves.toBe("0");
  });

  it("rejects foreign and same-project non-confirmed profiles with whole-batch rollback", async () => {
    const local = await createFixture(handle);
    const foreign = await createFixture(handle);
    const localInputs = productInputs(local).map(rawInput);
    const foreignMember: RawKeywordOccurrenceInput = {
      ...localInputs[1]!,
      productProfileId: foreign.profileId,
      sourceRef:
        `product_profile:${foreign.profileId}#profile-generative-query.v1/${TEMPLATE_IDS[1]}`,
    };
    await expectPgCode(
      callRawBatch(handle, local, [localInputs[0]!, foreignMember]),
      "23514",
    );
    await expect(occurrenceCount(handle, local)).resolves.toBe("0");

    const nonConfirmed = await createFixture(handle);
    const nonConfirmedInputs = productInputs(nonConfirmed).map(rawInput);
    const nonConfirmedMember: RawKeywordOccurrenceInput = {
      ...nonConfirmedInputs[1]!,
      productProfileId: nonConfirmed.unconfirmedProfileId,
      sourceRef:
        `product_profile:${nonConfirmed.unconfirmedProfileId}#profile-generative-query.v1/${TEMPLATE_IDS[1]}`,
      collectedAt: UNCONFIRMED_PROFILE_CREATED_AT,
    };
    await expectPgCode(
      callRawBatch(handle, nonConfirmed, [
        nonConfirmedInputs[0]!,
        nonConfirmedMember,
      ]),
      "23514",
    );
    await expect(occurrenceCount(handle, nonConfirmed)).resolves.toBe("0");
  });

  it.each([
    {
      label: "unknown template",
      corrupt: (input: RawKeywordOccurrenceInput) => ({
        ...input,
        sourceRef:
          `${input.sourceRef.slice(0, input.sourceRef.lastIndexOf("/") + 1)}invented-template`,
      }),
    },
    {
      label: "wrong profile time",
      corrupt: (input: RawKeywordOccurrenceInput) => ({
        ...input,
        collectedAt: "2026-08-09T09:30:00.001Z",
      }),
    },
    {
      label: "non-primary profile market even when the primary Site includes it",
      corrupt: (input: RawKeywordOccurrenceInput) => ({
        ...input,
        market: "CA",
      }),
    },
    {
      label: "wrong language",
      corrupt: (input: RawKeywordOccurrenceInput) => ({
        ...input,
        languageTag: "en-GB",
      }),
    },
    {
      label: "non-canonical language case",
      corrupt: (input: RawKeywordOccurrenceInput) => ({
        ...input,
        languageTag: "en-us",
      }),
    },
    {
      label: "non-canonical display",
      corrupt: (input: RawKeywordOccurrenceInput) => ({
        ...input,
        displayKeyword: `  ${input.displayKeyword}  `,
      }),
    },
    {
      label: "non-canonical normalized identity",
      corrupt: (input: RawKeywordOccurrenceInput) => ({
        ...input,
        normalizedKeyword: input.normalizedKeyword.toUpperCase(),
      }),
    },
    {
      label: "invented provider and manual lineage",
      corrupt: (input: RawKeywordOccurrenceInput) => ({
        ...input,
        occurrenceId: randomUUID(),
        dataSnapshotId: randomUUID(),
        observationId: randomUUID(),
        sourcePointer: "/valueJson/keyword",
        providerDataAsOf: PROFILE_CREATED_AT,
      }),
    },
  ])("rejects $label and rolls back a valid sibling", async ({ corrupt }) => {
    const fixture = await createFixture(handle);
    const inputs = productInputs(fixture).map(rawInput);
    await expectPgCode(
      callRawBatch(handle, fixture, [inputs[0]!, corrupt(inputs[1]!)]),
      "23514",
    );
    await expect(occurrenceCount(handle, fixture)).resolves.toBe("0");
  });

  it("fails closed on malformed direct batch JSON rather than accepting shape drift", async () => {
    const fixture = await createFixture(handle);
    const [member] = productInputs(fixture).map(rawInput);
    const { productProfileId: _missing, ...missingProductProfileId } = member!;

    await expectPgCode(
      callRawBatch(handle, fixture, [missingProductProfileId]),
      "23514",
    );
    await expectPgCode(
      callRawBatch(handle, fixture, [
        { ...member!, unexpectedLineage: "forged" },
      ]),
      "23514",
    );
    await expect(occurrenceCount(handle, fixture)).resolves.toBe("0");
  });
});
