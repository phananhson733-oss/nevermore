// @input  -- existing seo_audit.sitewide.v3 envelopes and projected Agent data
// @output -- frozen authenticated Agent API types plus strict client/upstream guards
// @pos    -- shared wire contract for the SEO and Tech Agent API and UI

import type {
  SeoAuditCoverage,
  SeoAuditPayload,
  SeoAuditReport,
  SeoAuditSiteResources,
} from "@sf/public-tools";
import {
  isCanonicalIsoTimestamp,
  isSeoAuditPayload,
  isSeoAuditRecord,
} from "@sf/public-tools/seo-audit/contract";

export { isCanonicalIsoTimestamp };

export type AgentKind = "seo" | "tech";
export type AgentAuditCacheStatus = "hit" | "miss";
export const AGENT_AUDIT_SOURCE_SCHEMA_VERSION =
  "seo_audit.sitewide.v3" as const;
export const AGENT_AUDIT_SOURCE_SCOPE =
  "discoverable_same_origin_static_html_audit" as const;

export interface AgentAuditSourceProvenance {
  readonly tool: "seo_audit";
  readonly schemaVersion: typeof AGENT_AUDIT_SOURCE_SCHEMA_VERSION;
  readonly completedAt: string;
  readonly cache: {
    readonly status: AgentAuditCacheStatus;
    readonly capturedAt: string | null;
  };
}

export interface AgentAuditRun {
  readonly agent: AgentKind;
  readonly mode: "authenticated_agent";
  readonly persistence: "none";
  readonly source: AgentAuditSourceProvenance;
}

/** The bounded report exposed to Agent clients. Raw crawled page rows stay server-side. */
export type AgentAuditResult = Pick<
  SeoAuditReport,
  | "targetUrl"
  | "siteOrigin"
  | "scannedAt"
  | "coverage"
  | "siteResources"
  | "records"
>;

export interface AgentAuditSuccessData {
  readonly run: AgentAuditRun;
  readonly result: AgentAuditResult;
}

export interface AgentAuditSuccessEnvelope {
  readonly data: AgentAuditSuccessData;
}

export interface AgentAuditErrorEnvelope<TCode extends string = string> {
  readonly error: { readonly code: TCode };
}

export type AgentAuditResponseEnvelope =
  | AgentAuditSuccessEnvelope
  | AgentAuditErrorEnvelope;

export interface SeoAuditUpstreamSuccessEnvelope {
  readonly data: {
    readonly run: Omit<
      SeoAuditPayload["run"],
      "schemaVersion" | "scope"
    > & {
      readonly schemaVersion: typeof AGENT_AUDIT_SOURCE_SCHEMA_VERSION;
      readonly scope: typeof AGENT_AUDIT_SOURCE_SCOPE;
    };
    readonly result: SeoAuditPayload["result"];
  };
}

type UnknownObject = Readonly<Record<string, unknown>>;

function isObject(value: unknown): value is UnknownObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isCoverage(value: unknown): value is SeoAuditCoverage {
  if (!isObject(value)) return false;
  return (
    ["available", "partial", "unavailable"].includes(
      value.availability as string,
    ) &&
    isNonNegativeInteger(value.pagesInspected) &&
    isNonNegativeInteger(value.linksObserved) &&
    isNonNegativeInteger(value.sitemapUrlsObserved) &&
    isNonNegativeInteger(value.urlsSkipped) &&
    isNonNegativeInteger(value.urlsBlocked) &&
    isNonNegativeInteger(value.urlsDisallowed) &&
    isNonNegativeInteger(value.urlsErrored) &&
    isNullableString(value.stopReason)
  );
}

function isSiteResources(value: unknown): value is SeoAuditSiteResources {
  if (!isObject(value)) return false;
  return (
    typeof value.robotsFetched === "boolean" &&
    isNonNegativeInteger(value.robotsGroupsObserved) &&
    isNonNegativeInteger(value.sitemapReferencesObserved) &&
    typeof value.sitemapFetched === "boolean"
  );
}

function isAgentResult(value: unknown, agent: AgentKind): value is AgentAuditResult {
  if (
    !isObject(value) ||
    typeof value.targetUrl !== "string" ||
    typeof value.siteOrigin !== "string" ||
    !isCanonicalIsoTimestamp(value.scannedAt) ||
    !isCoverage(value.coverage) ||
    !isSiteResources(value.siteResources) ||
    !Array.isArray(value.records) ||
    !value.records.every(isSeoAuditRecord)
  ) {
    return false;
  }

  const allowed =
    agent === "seo"
      ? new Set(["metadata", "structure", "structured_data"])
      : new Set(["crawl", "indexability", "links"]);
  return value.records.every(
    (record) => isObject(record) && allowed.has(record.category as string),
  );
}

export function isAgentAuditSuccessEnvelope(
  value: unknown,
): value is AgentAuditSuccessEnvelope {
  if (!isObject(value) || !isObject(value.data) || !isObject(value.data.run)) {
    return false;
  }

  const { run } = value.data;
  const agent = run.agent;
  if (
    (agent !== "seo" && agent !== "tech") ||
    run.mode !== "authenticated_agent" ||
    run.persistence !== "none" ||
    !isObject(run.source) ||
    run.source.tool !== "seo_audit" ||
    run.source.schemaVersion !== AGENT_AUDIT_SOURCE_SCHEMA_VERSION ||
    !isCanonicalIsoTimestamp(run.source.completedAt) ||
    !isObject(run.source.cache) ||
    (run.source.cache.status !== "hit" && run.source.cache.status !== "miss") ||
    (run.source.cache.status === "hit"
      ? !isCanonicalIsoTimestamp(run.source.cache.capturedAt)
      : run.source.cache.capturedAt !== null)
  ) {
    return false;
  }

  return isAgentResult(value.data.result, agent);
}

/** Strictly validates the existing buffered crawler envelope before projection. */
export function isSeoAuditUpstreamSuccessEnvelope(
  value: unknown,
): value is SeoAuditUpstreamSuccessEnvelope {
  return isObject(value) && isSeoAuditPayload(value.data);
}
