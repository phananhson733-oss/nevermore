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

/** The `overview` workspace projection (spec §11.3). */
export interface OverviewView {
  readonly view: "overview";
  readonly project: Project;
  readonly coverage: Coverage;
  readonly activeRuns: readonly unknown[];
  readonly topActions: readonly unknown[];
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
