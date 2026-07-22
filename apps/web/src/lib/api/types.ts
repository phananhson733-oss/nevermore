/**
 * Hand-authored response DTOs for the browser API client. These mirror the
 * server envelope shapes (spec §11.1) and the OpenAPI `Project`, `Site`,
 * `IcpProfile`, `Coverage`, `OverviewView`, and `Problem` schemas. Fields are
 * `readonly`: fetched server state is cached by TanStack Query and must never be
 * mutated in place (repo convention: 一切不可变).
 *
 * These are kept in sync by hand (not generated) so the client stays decoupled
 * from `@sf/contracts` generated types; the endpoint contract is the authority.
 */

export type ProjectStage =
  | "setup"
  | "collecting"
  | "ready_to_diagnose"
  | "diagnosing"
  | "planning"
  | "executing"
  | "delivered";

export type ContextStatus = "missing" | "draft" | "complete";

/** A site under a project (OpenAPI `Site`). */
export interface SiteDto {
  readonly id: string;
  readonly origin: string;
  readonly host: string;
  readonly marketCodes: readonly string[];
  readonly languageCodes: readonly string[];
}

/** A project (OpenAPI `Project`). */
export interface Project {
  readonly id: string;
  readonly clientName: string;
  readonly projectName: string;
  readonly stage: ProjectStage;
  readonly site: SiteDto;
  readonly contextStatus: ContextStatus;
  readonly currentIcpProfileVersion: number | null;
  readonly confirmedIcpProfileVersion?: number | null;
  readonly defaultDeliveryLocale: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly archivedAt: string | null;
}

/** A persisted ICP profile snapshot (OpenAPI `IcpProfile`). */
export interface IcpProfile {
  readonly id: string;
  readonly projectId: string;
  readonly version: number;
  readonly status: "draft" | "complete";
  readonly profile: Record<string, unknown>;
  readonly contentHash: string;
  readonly createdAt: string;
}

/** Evidence coverage summary for a project (OpenAPI `Coverage`). */
export interface Coverage {
  readonly overall: "unavailable" | "partial" | "complete";
  readonly domains: Record<string, string>;
  readonly limitations: readonly string[];
}

export type OverviewPriorityBand = "critical" | "high" | "medium" | "low";
export type OverviewRoadmapLane = "now" | "next" | "later";
export type OverviewActionStatus =
  | "candidate"
  | "planned"
  | "in_progress"
  | "blocked"
  | "done"
  | "dismissed";

/** Canonical persisted Action DTO surfaced by the Overview read model. */
export interface OverviewAction {
  readonly id: string;
  readonly findingId: string;
  readonly templateId: string;
  readonly title: string;
  readonly description: string;
  readonly contentLocale: string;
  readonly priorityBand: OverviewPriorityBand;
  readonly roadmapLane: OverviewRoadmapLane;
  readonly status: OverviewActionStatus;
  readonly effort: "small" | "medium" | "large";
  readonly risk: "low" | "medium" | "high";
  readonly expectedOutcome: string;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

/** Latest immutable source snapshot selected by its real capture timestamp. */
export interface OverviewSnapshot {
  readonly id: string;
  readonly siteId: string;
  readonly provider: string;
  readonly datasetKey: string;
  readonly schemaVersion: string;
  readonly methodVersion: string;
  readonly capturedAt: string;
  readonly sourceWindow: {
    readonly start: string | null;
    readonly end: string | null;
  };
  readonly availability: "available" | "partial" | "unavailable";
  readonly limitation: string;
  readonly rowCount: number;
  readonly checksum: string;
}

/** Evidence rows explicitly associated with the highest-priority Action. */
export interface OverviewEvidence {
  readonly id: string;
  readonly sourceProvider: string;
  readonly origin: string;
  readonly method: string;
  readonly grade: string;
  readonly availability: "available" | "partial" | "unavailable";
  readonly support: string;
  readonly claim: string;
  readonly subjectRefs: readonly {
    readonly type: string;
    readonly value: string;
  }[];
  readonly observedAt: string;
  readonly limitation: string;
  readonly snapshotId: string | null;
  readonly collectionRunId: string | null;
  readonly analysisInvocationId: string | null;
}

/** Minimal canonical Artifact projection used by Overview's delivery focus. */
export interface OverviewDeliveryFocus {
  readonly artifactId: string;
  readonly actionId: string;
  readonly artifactType:
    | "content_brief"
    | "metadata_rewrite"
    | "technical_ticket";
  readonly status: "generating" | "draft" | "ready" | "failed" | "archived";
  readonly updatedAt: string;
}

/** The `overview` workspace projection (spec §11.3). */
export interface OverviewView {
  readonly view: "overview";
  readonly project: Project;
  readonly coverage: Coverage;
  readonly activeRuns: readonly unknown[];
  readonly topActions: readonly OverviewAction[];
  readonly latestSnapshot: OverviewSnapshot | null;
  readonly topActionEvidence: readonly OverviewEvidence[];
  readonly deliveryFocus: OverviewDeliveryFocus | null;
}

/** Pagination metadata carried alongside list payloads (OpenAPI `PageMeta`). */
export interface PageMeta {
  readonly nextCursor: string | null;
  readonly hasNext: boolean;
  readonly limit: number;
}

/** A single field-level validation error, JSON-pointer addressed (AC-008). */
export interface ProblemFieldError {
  readonly pointer: string;
  readonly code: string;
  readonly message: string;
}

/** RFC 9457 problem+json error body (spec §11.1). */
export interface ProblemBody {
  readonly type: string;
  readonly title: string;
  readonly status: number;
  readonly code: string;
  readonly detail: string;
  readonly requestId: string;
  readonly errors?: readonly ProblemFieldError[];
  readonly current?: Readonly<Record<string, unknown>> | null;
}

/** Success envelope for a single resource: `{ data }`. */
export interface DataEnvelope<T> {
  readonly data: T;
}

/** Success envelope for a list: `{ data, meta }`. */
export interface ListEnvelope<T> {
  readonly data: readonly T[];
  readonly meta: PageMeta;
}
