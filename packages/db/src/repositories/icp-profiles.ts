import {
  ProductProfileDraft as ProductProfileDraftSchema,
  type ProductProfileDraft,
} from "@sf/contracts";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  contentHash as hashContent,
  type CanonicalValue,
} from "../hash.ts";
import { icpProfiles } from "../schema.ts";
import {
  Repository,
  projectPredicate,
  workspacePredicate,
  type ProjectScope,
  type WorkspaceScope,
} from "./base.ts";

/** Persisted ICP profile snapshot payload (the opaque `profile` jsonb column). */
export type IcpProfileData = Record<string, unknown>;

/**
 * `icp_profiles` is append-only and immutable (spec §12.3). Each save is a new
 * version row; the project's `current_icp_profile_id` selects the active one.
 * `UNIQUE (project_id, version)` and `UNIQUE (project_id, content_hash)` enforce
 * monotonic versions and no duplicate content (spec §6.2, AC-009).
 */

export type IcpStatus = "draft" | "complete";

export interface IcpProfileRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly version: number;
  readonly status: IcpStatus;
  readonly profile: IcpProfileData;
  readonly content_hash: string;
  readonly created_by: string;
  readonly created_at: string;
}

export type ProductProfileCanonicalEvidenceKind =
  | "snapshot"
  | "pageSnapshot"
  | "observation"
  | "analysisInvocation";

export type ProductProfileProvenanceIssueCode =
  | "profile_contract_invalid"
  | "unsupported_profile_schema"
  | "source_site_missing"
  | "source_snapshot_missing"
  | "source_snapshot_site_mismatch"
  | "analysis_invocation_missing"
  | "analysis_invocation_task_mismatch"
  | "incomplete_synthesis_lineage"
  | "invalid_field_provenance"
  | "invalid_evidence_refs"
  | "declared_reference_contains_canonical_id"
  | "unsupported_evidence_reference"
  | "canonical_lineage_missing"
  | "snapshot_reference_mismatch"
  | "page_snapshot_missing"
  | "page_snapshot_snapshot_mismatch"
  | "page_snapshot_site_mismatch"
  | "observation_missing"
  | "observation_snapshot_mismatch"
  | "analysis_invocation_reference_mismatch";

export interface ProductProfileProvenanceIssue {
  readonly code: ProductProfileProvenanceIssueCode;
  readonly path: string;
  readonly refKind?: ProductProfileCanonicalEvidenceKind;
  readonly refId?: string;
}

export type ProductProfileProvenancePreflightResult<
  T extends ProductProfileDraft = ProductProfileDraft,
> =
  | {
      readonly ok: true;
      readonly profile: T;
      readonly canonicalRefs: {
        readonly sourceSiteId: string;
        readonly sourceSnapshotId: string | null;
        readonly analysisInvocationId: string | null;
        readonly pageSnapshotIds: readonly string[];
        readonly observationIds: readonly string[];
      };
    }
  | {
      readonly ok: false;
      readonly issues: readonly ProductProfileProvenanceIssue[];
    };

const PRODUCT_PROFILE_PROVENANCE_CODES = new Set<ProductProfileProvenanceIssueCode>([
  "profile_contract_invalid",
  "unsupported_profile_schema",
  "source_site_missing",
  "source_snapshot_missing",
  "source_snapshot_site_mismatch",
  "analysis_invocation_missing",
  "analysis_invocation_task_mismatch",
  "incomplete_synthesis_lineage",
  "invalid_field_provenance",
  "invalid_evidence_refs",
  "declared_reference_contains_canonical_id",
  "unsupported_evidence_reference",
  "canonical_lineage_missing",
  "snapshot_reference_mismatch",
  "page_snapshot_missing",
  "page_snapshot_snapshot_mismatch",
  "page_snapshot_site_mismatch",
  "observation_missing",
  "observation_snapshot_mismatch",
  "analysis_invocation_reference_mismatch",
]);

const PRODUCT_PROFILE_CANONICAL_KINDS = new Set<ProductProfileCanonicalEvidenceKind>([
  "snapshot",
  "pageSnapshot",
  "observation",
  "analysisInvocation",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseProductProfileProvenanceValidation(
  raw: unknown,
): { readonly ok: boolean; readonly issues: readonly ProductProfileProvenanceIssue[] } {
  if (!isRecord(raw) || typeof raw["ok"] !== "boolean" || !Array.isArray(raw["issues"])) {
    throw new Error("invalid Product Profile provenance validation result");
  }
  const issues = raw["issues"].map((candidate) => {
    if (!isRecord(candidate)) {
      throw new Error("invalid Product Profile provenance issue");
    }
    const code = candidate["code"];
    const path = candidate["path"];
    const refKind = candidate["refKind"];
    const refId = candidate["refId"];
    if (
      typeof code !== "string" ||
      !PRODUCT_PROFILE_PROVENANCE_CODES.has(
        code as ProductProfileProvenanceIssueCode,
      ) ||
      typeof path !== "string" ||
      !path.startsWith("/") ||
      (refKind !== undefined &&
        (typeof refKind !== "string" ||
          !PRODUCT_PROFILE_CANONICAL_KINDS.has(
            refKind as ProductProfileCanonicalEvidenceKind,
          ))) ||
      (refId !== undefined && refId !== null && typeof refId !== "string")
    ) {
      throw new Error("invalid Product Profile provenance issue");
    }
    return {
      code: code as ProductProfileProvenanceIssueCode,
      path,
      ...(refKind === undefined
        ? {}
        : { refKind: refKind as ProductProfileCanonicalEvidenceKind }),
      ...(typeof refId === "string" ? { refId } : {}),
    } satisfies ProductProfileProvenanceIssue;
  });
  if (raw["ok"] !== (issues.length === 0)) {
    throw new Error("incoherent Product Profile provenance validation result");
  }
  return { ok: raw["ok"], issues };
}

export class IcpProfilesRepository extends Repository {
  /**
   * Preflight the complete, contract-parsed Product Profile against immutable
   * scoped source rows. The authoritative insert trigger invokes the same SQL
   * provenance validator, so this clean 422 path cannot drift from the
   * cross-row persistence policy.
   */
  async preflightProductProfileProvenance<T extends ProductProfileDraft>(
    scope: ProjectScope,
    profile: T,
  ): Promise<ProductProfileProvenancePreflightResult<T>> {
    const parsed = ProductProfileDraftSchema.safeParse(profile);
    if (!parsed.success) {
      return {
        ok: false,
        issues: parsed.error.issues.map((issue) => ({
          code: "profile_contract_invalid" as const,
          path: `/${issue.path.map(String).join("/")}`,
        })),
      };
    }

    const result = await this.exec.execute(sql`
      select app.validate_product_profile_provenance(
        ${scope.workspaceId}::uuid,
        ${scope.projectId}::uuid,
        ${JSON.stringify(parsed.data)}::jsonb
      ) as result
    `);
    const first = (result as unknown as {
      readonly rows?: readonly { readonly result?: unknown }[];
    }).rows?.[0];
    if (first === undefined) {
      throw new Error("missing Product Profile provenance validation result");
    }
    const validation = parseProductProfileProvenanceValidation(first.result);
    if (!validation.ok) return { ok: false, issues: validation.issues };

    const pageSnapshotIds = new Set<string>();
    const observationIds = new Set<string>();
    for (const entry of parsed.data.fieldProvenance) {
      for (const ref of entry.evidenceRefs) {
        if (ref.kind === "pageSnapshot") {
          pageSnapshotIds.add(ref.pageSnapshotId);
        } else if (ref.kind === "observation") {
          observationIds.add(ref.observationId);
        }
      }
    }
    return {
      ok: true,
      profile: parsed.data as T,
      canonicalRefs: {
        sourceSiteId: parsed.data.sourceSiteId,
        sourceSnapshotId: parsed.data.sourceSnapshotId,
        analysisInvocationId: parsed.data.analysisInvocationId,
        pageSnapshotIds: [...pageSnapshotIds],
        observationIds: [...observationIds],
      },
    };
  }

  /** The current version pointed to by the project, or null before the first save. */
  async findById(
    scope: ProjectScope,
    id: string,
  ): Promise<IcpProfileRow | null> {
    const rows = await this.exec
      .select()
      .from(icpProfiles)
      .where(and(projectPredicate(icpProfiles, scope), eq(icpProfiles.id, id)))
      .limit(1);
    return (rows[0] as IcpProfileRow | undefined) ?? null;
  }

  /** An existing version with this content hash, if any (semantic-noop dedup). */
  async findByContentHash(
    scope: ProjectScope,
    contentHash: string,
  ): Promise<IcpProfileRow | null> {
    const rows = await this.exec
      .select()
      .from(icpProfiles)
      .where(
        and(
          projectPredicate(icpProfiles, scope),
          eq(icpProfiles.content_hash, contentHash),
        ),
      )
      .limit(1);
    return (rows[0] as IcpProfileRow | undefined) ?? null;
  }

  /**
   * Map of ICP versions keyed by id, for a batch of current-profile ids in the
   * workspace (spec §11.1: list pages must not N+1). Scoped by workspace_id.
   */
  async mapByIds(
    scope: WorkspaceScope,
    ids: readonly string[],
  ): Promise<Map<string, IcpProfileRow>> {
    if (ids.length === 0) return new Map();
    const rows = (await this.exec
      .select()
      .from(icpProfiles)
      .where(
        and(
          workspacePredicate(icpProfiles, scope),
          inArray(icpProfiles.id, [...ids]),
        ),
      )) as IcpProfileRow[];
    return new Map(rows.map((row) => [row.id, row]));
  }

  /** Highest version number for the project (0 when none). */
  async maxVersion(scope: ProjectScope): Promise<number> {
    const rows = await this.exec
      .select({ version: icpProfiles.version })
      .from(icpProfiles)
      .where(projectPredicate(icpProfiles, scope))
      .orderBy(desc(icpProfiles.version))
      .limit(1);
    return rows[0]?.version ?? 0;
  }

  /** Append a new immutable version (inside the save transaction). */
  async insertVersion(values: {
    workspaceId: string;
    projectId: string;
    version: number;
    status: IcpStatus;
    profile: IcpProfileData;
    contentHash: string;
    createdBy: string;
  }): Promise<IcpProfileRow> {
    let profile = values.profile;
    if (
      profile["profileSchemaVersion"] === "product-profile.0.3.0"
    ) {
      const parsed = ProductProfileDraftSchema.safeParse(profile);
      if (!parsed.success) {
        throw new TypeError("Product Profile 0.3 payload is not contract-valid", {
          cause: parsed.error,
        });
      }
      profile = parsed.data;
      const expectedHash = hashContent({
        status: values.status,
        profile: profile as CanonicalValue,
      });
      if (expectedHash !== values.contentHash) {
        throw new TypeError(
          "Product Profile content hash does not match its parsed payload",
        );
      }
    }
    const [row] = await this.exec
      .insert(icpProfiles)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        version: values.version,
        status: values.status,
        profile,
        content_hash: values.contentHash,
        created_by: values.createdBy,
      })
      .returning();
    return row as IcpProfileRow;
  }
}
