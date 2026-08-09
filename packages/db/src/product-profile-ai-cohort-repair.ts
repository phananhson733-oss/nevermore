import { pathToFileURL } from "node:url";
import { ConfirmedProductProfile } from "@sf/contracts";
import { postgresUrlIssue } from "@sf/contracts/runtime-url";
import { and, eq, isNull } from "drizzle-orm";
import { createDbHandle, type Db } from "./client.ts";
import { clientProjects, icpProfiles, sites } from "./schema.ts";
import {
  canonicalProductProfileSiteLanguageTag,
  deriveConfirmedProductProfileGenerativeQueries,
  ProductProfileAiCohortRepository,
  type DerivedProductProfileGenerativeQueryResult,
  type ProductProfileAiCohortBootstrapInput,
  type ProductProfileAiCohortBootstrapResult,
} from "./repositories/product-profile-ai-cohort.ts";

export interface ProductProfileAiCohortRepairOptions {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly expectedProfileId: string;
  readonly expectedProfileVersion: number;
  readonly expectedContentHash: string;
  readonly mode: "dry-run" | "apply";
}

export type ProductProfileAiCohortRepairFailureCode =
  | "INVALID_ARGUMENTS"
  | "DATABASE_CONFIG_MISSING"
  | "DATABASE_CONFIG_INVALID"
  | "PROFILE_IDENTITY_MISMATCH"
  | "PROFILE_CONTRACT_INVALID"
  | "PRIMARY_SITE_CONTEXT_AMBIGUOUS"
  | "DERIVATION_INVARIANT_VIOLATION";

export class ProductProfileAiCohortRepairError extends Error {
  constructor(
    readonly code: ProductProfileAiCohortRepairFailureCode,
  ) {
    super(
      code === "INVALID_ARGUMENTS"
        ? "Invalid Product Profile AI cohort repair arguments."
        : "Product Profile AI cohort repair failed.",
    );
    this.name = "ProductProfileAiCohortRepairError";
  }
}

interface RepairProjectIdentity {
  readonly confirmedProfileId: string | null;
}

interface RepairProfileRow {
  readonly id: string;
  readonly version: number;
  readonly status: string;
  readonly profile: unknown;
  readonly contentHash: string;
  readonly createdAt: string;
}

interface RepairPrimarySiteRow {
  readonly id: string;
  readonly marketCodes: readonly string[];
  readonly languageCodes: readonly string[];
}

interface ProductProfileAiCohortRepairTransaction {
  lockActiveProject(scope: {
    readonly workspaceId: string;
    readonly projectId: string;
  }): Promise<RepairProjectIdentity | null>;
  findConfirmedProfile(
    scope: { readonly workspaceId: string; readonly projectId: string },
    profileId: string,
  ): Promise<RepairProfileRow | null>;
  listPrimarySites(scope: {
    readonly workspaceId: string;
    readonly projectId: string;
  }): Promise<readonly RepairPrimarySiteRow[]>;
  countGenerativeQueries(scope: {
    readonly workspaceId: string;
    readonly projectId: string;
  }): Promise<number>;
  bootstrapConfirmedProfileGenerativeQueries(
    scope: { readonly workspaceId: string; readonly projectId: string },
    input: ProductProfileAiCohortBootstrapInput,
  ): Promise<ProductProfileAiCohortBootstrapResult>;
}

export interface ProductProfileAiCohortRepairDependencies {
  readonly transaction: <T>(
    operation: (tx: ProductProfileAiCohortRepairTransaction) => Promise<T>,
  ) => Promise<T>;
  readonly deriveConfirmedProductProfileGenerativeQueries: (
    input: ProductProfileAiCohortBootstrapInput,
  ) => DerivedProductProfileGenerativeQueryResult;
}

export interface ProductProfileAiCohortRepairResult {
  readonly workspaceId: string;
  readonly projectId: string;
  readonly profileId: string;
  readonly profileVersion: number;
  readonly profileContentHash: string;
  readonly mode: "dry-run" | "apply";
  readonly status:
    | "would_bootstrap"
    | ProductProfileAiCohortBootstrapResult["status"];
  readonly existingQueryCount: number;
  readonly derivedQueryCount: number;
  readonly bootstrappedQueryCount: number;
  readonly querySetHash?: string;
}

interface ProductProfileAiCohortRepairCliRuntime {
  readonly repairDependencies: ProductProfileAiCohortRepairDependencies;
  close(): Promise<void>;
}

export interface ProductProfileAiCohortRepairCliDependencies {
  readonly createRuntime: (
    databaseUrl: string,
  ) => ProductProfileAiCohortRepairCliRuntime;
  readonly writeStdout: (line: string) => void;
  readonly writeStderr: (line: string) => void;
}

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/iu;
const IDENTITY_OPTIONS = new Set([
  "--workspace-id",
  "--project-id",
  "--expected-profile-id",
  "--expected-profile-version",
  "--expected-content-hash",
]);

function invalidArguments(): never {
  throw new ProductProfileAiCohortRepairError("INVALID_ARGUMENTS");
}

export function parseProductProfileAiCohortRepairArguments(
  argv: readonly string[],
): ProductProfileAiCohortRepairOptions {
  const applyCount = argv.filter((argument) => argument === "--apply").length;
  const apply = applyCount === 1 && argv.at(-1) === "--apply";
  if (applyCount > 1 || (applyCount === 1 && !apply)) invalidArguments();
  const identityArguments = apply ? argv.slice(0, -1) : argv;
  if (identityArguments.length !== IDENTITY_OPTIONS.size * 2) {
    invalidArguments();
  }
  const values = new Map<string, string>();
  for (let index = 0; index < identityArguments.length; index += 2) {
    const name = identityArguments[index];
    const value = identityArguments[index + 1];
    if (
      !name ||
      !IDENTITY_OPTIONS.has(name) ||
      values.has(name) ||
      !value ||
      value.startsWith("--")
    ) {
      invalidArguments();
    }
    values.set(name, value);
  }
  const workspaceId = values.get("--workspace-id");
  const projectId = values.get("--project-id");
  const expectedProfileId = values.get("--expected-profile-id");
  const expectedProfileVersionValue = values.get(
    "--expected-profile-version",
  );
  const expectedContentHash = values.get("--expected-content-hash");
  if (
    !workspaceId ||
    !projectId ||
    !expectedProfileId ||
    !expectedProfileVersionValue ||
    !expectedContentHash ||
    !UUID.test(workspaceId) ||
    !UUID.test(projectId) ||
    !UUID.test(expectedProfileId) ||
    !/^[1-9][0-9]*$/u.test(expectedProfileVersionValue) ||
    !SHA256.test(expectedContentHash)
  ) {
    invalidArguments();
  }
  const expectedProfileVersion = Number(expectedProfileVersionValue);
  if (!Number.isSafeInteger(expectedProfileVersion)) invalidArguments();
  return {
    workspaceId: workspaceId.toLowerCase(),
    projectId: projectId.toLowerCase(),
    expectedProfileId: expectedProfileId.toLowerCase(),
    expectedProfileVersion,
    expectedContentHash: expectedContentHash.toLowerCase(),
    mode: apply ? "apply" : "dry-run",
  };
}

export async function repairProductProfileAiCohort(
  options: ProductProfileAiCohortRepairOptions,
  dependencies: ProductProfileAiCohortRepairDependencies,
): Promise<ProductProfileAiCohortRepairResult> {
  return dependencies.transaction(async (tx) => {
    const scope = {
      workspaceId: options.workspaceId,
      projectId: options.projectId,
    };
    const project = await tx.lockActiveProject(scope);
    if (project?.confirmedProfileId !== options.expectedProfileId) {
      throw new ProductProfileAiCohortRepairError(
        "PROFILE_IDENTITY_MISMATCH",
      );
    }
    const row = await tx.findConfirmedProfile(
      scope,
      options.expectedProfileId,
    );
    if (
      !row ||
      row.id !== options.expectedProfileId ||
      row.version !== options.expectedProfileVersion ||
      row.status !== "complete" ||
      row.contentHash !== options.expectedContentHash
    ) {
      throw new ProductProfileAiCohortRepairError(
        "PROFILE_IDENTITY_MISMATCH",
      );
    }
    const parsedProfile = ConfirmedProductProfile.safeParse(row.profile);
    if (!parsedProfile.success) {
      throw new ProductProfileAiCohortRepairError(
        "PROFILE_CONTRACT_INVALID",
      );
    }
    const primarySites = await tx.listPrimarySites(scope);
    const primarySite = primarySites.length === 1 ? primarySites[0] : undefined;
    const marketCode = parsedProfile.data.targetMarkets.find(
      (market) => market.priority === "primary",
    )?.marketCode.trim().toUpperCase();
    const siteContainsPrimaryMarket =
      marketCode !== undefined &&
      (primarySite?.marketCodes.includes(marketCode) ?? false);
    const rawLanguageTag = primarySite?.languageCodes.length === 1
      ? primarySite.languageCodes[0]?.trim()
      : undefined;
    const languageTag = rawLanguageTag
      ? canonicalProductProfileSiteLanguageTag(rawLanguageTag) ?? undefined
      : undefined;
    if (
      !marketCode ||
      !/^[A-Z]{2}$/u.test(marketCode) ||
      !siteContainsPrimaryMarket ||
      !languageTag
    ) {
      throw new ProductProfileAiCohortRepairError(
        "PRIMARY_SITE_CONTEXT_AMBIGUOUS",
      );
    }
    const input: ProductProfileAiCohortBootstrapInput = {
      confirmedProfileId: row.id,
      confirmedProfileVersion: row.version,
      confirmedProfileContentHash: row.contentHash,
      confirmedAt: row.createdAt,
      marketCode,
      languageTag,
      profile: parsedProfile.data,
    };
    if (options.mode === "apply") {
      const applied =
        await tx.bootstrapConfirmedProfileGenerativeQueries(scope, input);
      return {
        workspaceId: options.workspaceId,
        projectId: options.projectId,
        profileId: row.id,
        profileVersion: row.version,
        profileContentHash: row.contentHash,
        mode: options.mode,
        status: applied.status,
        existingQueryCount: applied.existingQueryCount,
        derivedQueryCount:
          applied.status === "bootstrapped" ? applied.bootstrappedCount : 0,
        bootstrappedQueryCount: applied.bootstrappedCount,
        ...(applied.querySetHash === null
          ? {}
          : { querySetHash: applied.querySetHash }),
      };
    }
    const existingQueryCount = await tx.countGenerativeQueries(scope);
    if (existingQueryCount > 0) {
      return {
        workspaceId: options.workspaceId,
        projectId: options.projectId,
        profileId: row.id,
        profileVersion: row.version,
        profileContentHash: row.contentHash,
        mode: options.mode,
        status: "skipped_existing_queries",
        existingQueryCount,
        derivedQueryCount: 0,
        bootstrappedQueryCount: 0,
      };
    }
    const derived =
      dependencies.deriveConfirmedProductProfileGenerativeQueries(input);
    if (derived.status === "ready" && derived.queries.length !== 20) {
      throw new ProductProfileAiCohortRepairError(
        "DERIVATION_INVARIANT_VIOLATION",
      );
    }
    return {
      workspaceId: options.workspaceId,
      projectId: options.projectId,
      profileId: row.id,
      profileVersion: row.version,
      profileContentHash: row.contentHash,
      mode: options.mode,
      status: derived.status === "ready" ? "would_bootstrap" : derived.status,
      existingQueryCount,
      derivedQueryCount: derived.queries.length,
      bootstrappedQueryCount: 0,
    };
  });
}

export async function runProductProfileAiCohortRepairCli(
  argv: readonly string[],
  environment: Readonly<Record<string, string | undefined>>,
  dependencies: ProductProfileAiCohortRepairCliDependencies,
): Promise<number> {
  let runtime: ProductProfileAiCohortRepairCliRuntime | null = null;
  try {
    const options = parseProductProfileAiCohortRepairArguments(argv);
    const databaseUrl = environment["DATABASE_URL"];
    if (!databaseUrl) {
      throw new ProductProfileAiCohortRepairError("DATABASE_CONFIG_MISSING");
    }
    runtime = dependencies.createRuntime(databaseUrl);
    const result = await repairProductProfileAiCohort(
      options,
      runtime.repairDependencies,
    );
    const completedRuntime = runtime;
    runtime = null;
    await completedRuntime.close();
    dependencies.writeStdout(`${JSON.stringify(result)}\n`);
    return 0;
  } catch (error) {
    if (runtime) {
      const failedRuntime = runtime;
      runtime = null;
      try {
        await failedRuntime.close();
      } catch {
        // Preserve the primary failure and never inspect a secret-bearing DB error.
      }
    }
    const code = error instanceof ProductProfileAiCohortRepairError
      ? error.code
      : "REPAIR_FAILED";
    dependencies.writeStderr(
      `${JSON.stringify({ status: "error", code })}\n`,
    );
    return 1;
  }
}

function createDatabaseRepairDependencies(
  db: Db,
): ProductProfileAiCohortRepairDependencies {
  return {
    transaction: (operation) =>
      db.transaction(async (tx) =>
        operation({
          async lockActiveProject(scope) {
            const rows = await tx
              .select({
                confirmedProfileId: clientProjects.confirmed_icp_profile_id,
              })
              .from(clientProjects)
              .where(
                and(
                  eq(clientProjects.workspace_id, scope.workspaceId),
                  eq(clientProjects.id, scope.projectId),
                  isNull(clientProjects.archived_at),
                ),
              )
              .limit(1)
              .for("update");
            return rows[0] ?? null;
          },
          async findConfirmedProfile(scope, profileId) {
            const rows = await tx
              .select({
                id: icpProfiles.id,
                version: icpProfiles.version,
                status: icpProfiles.status,
                profile: icpProfiles.profile,
                contentHash: icpProfiles.content_hash,
                createdAt: icpProfiles.created_at,
              })
              .from(icpProfiles)
              .where(
                and(
                  eq(icpProfiles.workspace_id, scope.workspaceId),
                  eq(icpProfiles.project_id, scope.projectId),
                  eq(icpProfiles.id, profileId),
                ),
              )
              .limit(1);
            return rows[0] ?? null;
          },
          async listPrimarySites(scope) {
            return tx
              .select({
                id: sites.id,
                marketCodes: sites.market_codes,
                languageCodes: sites.language_codes,
              })
              .from(sites)
              .where(
                and(
                  eq(sites.workspace_id, scope.workspaceId),
                  eq(sites.project_id, scope.projectId),
                  eq(sites.is_primary, true),
                ),
              )
              .limit(2);
          },
          countGenerativeQueries(scope) {
            return new ProductProfileAiCohortRepository(
              tx,
            ).countGenerativeQueries(scope);
          },
          bootstrapConfirmedProfileGenerativeQueries(scope, input) {
            return new ProductProfileAiCohortRepository(
              tx,
            ).bootstrapConfirmedProfileGenerativeQueries(scope, input);
          },
        }),
      ),
    deriveConfirmedProductProfileGenerativeQueries,
  };
}

export function createProductProfileAiCohortRepairRuntime(
  databaseUrl: string,
): ProductProfileAiCohortRepairCliRuntime {
  if (postgresUrlIssue(databaseUrl) !== null) {
    throw new ProductProfileAiCohortRepairError("DATABASE_CONFIG_INVALID");
  }
  const handle = createDbHandle(databaseUrl, 1);
  return {
    repairDependencies: createDatabaseRepairDependencies(handle.db),
    close: () => handle.end(),
  };
}

function isDirectExecution(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(entry).href;
  } catch {
    return false;
  }
}

if (isDirectExecution()) {
  void runProductProfileAiCohortRepairCli(
    process.argv.slice(2),
    process.env,
    {
      createRuntime: createProductProfileAiCohortRepairRuntime,
      writeStdout: (line) => {
        process.stdout.write(line);
      },
      writeStderr: (line) => {
        process.stderr.write(line);
      },
    },
  ).then((exitCode) => {
    process.exitCode = exitCode;
  }).catch(() => {
    try {
      process.stderr.write(
        `${JSON.stringify({ status: "error", code: "REPAIR_FAILED" })}\n`,
      );
    } catch {
      // A broken output sink cannot safely reveal or recover the failure.
    }
    process.exitCode = 1;
  });
}
