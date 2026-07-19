import { redact } from "@sf/observability";
import { telemetryEvents } from "../schema.ts";
import { Repository } from "./base.ts";

/**
 * Append-only product telemetry (spec §15.1). Exactly five event names are
 * allowed; `project_id` is nullable (workspace-level events). Properties use a
 * small allowlist and must never carry client content, URLs, query text, or
 * model prompt/output (spec §14.4).
 *
 * Properties are first projected through the event's exact allowlist and fixed
 * value domains. Deep redaction then remains a final runtime backstop (spec
 * §14.3/§15.2); it is not a license to persist arbitrary caller content.
 */

export type TelemetryEventName =
  | "project_created"
  | "source_snapshot_ready"
  | "diagnostic_completed"
  | "action_confirmed"
  | "export_ready";

const PROFILE_TYPES = new Set([
  "b2b_saas",
  "b2b_services",
  "b2c_ecommerce",
  "b2c_subscription",
  "marketplace",
  "publisher",
  "other",
]);

const PROVIDERS = new Set(["crawl", "gsc", "ga4", "csv", "dataforseo"]);
const AVAILABILITIES = new Set(["available", "partial", "unavailable"]);
const TERMINAL_RUN_STATUSES = new Set([
  "completed",
  "partial",
  "failed",
  "cancelled",
]);
const DURATION_BUCKETS = new Set([
  "under_5s",
  "under_30s",
  "under_2m",
  "under_10m",
  "over_10m",
]);
const RULE_IDS = new Set([
  "TECH-HTTP-001",
  "TECH-CANONICAL-002",
  "TECH-LINKGRAPH-005",
  "SEARCH-CTR-004",
  "SEARCH-DECAY-002",
  "CONTENT-COVERAGE-001",
  "CONTENT-GAP-011",
  "CRO-PATH-001",
  "CRO-LANDING-003",
  "GEO-ENTITY-001",
  "GEO-CRAWLER-002",
]);
const PRIORITY_BANDS = new Set(["critical", "high", "medium", "low"]);
const ROADMAP_LANES = new Set(["now", "next", "later"]);
const EXPORT_KINDS = new Set(["service_bundle", "client_bundle"]);
const SIZE_BUCKETS = new Set(["under_1mb", "under_10mb", "over_10mb"]);

/** The only count dimensions emitted by the current manifest assembler. */
const ITEM_COUNT_KEYS = [
  "projects",
  "contexts",
  "sources",
  "snapshots",
  "observations",
  "findings",
  "evidence",
  "actions",
  "artifacts",
  "artifactRevisions",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function addEnum(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
  allowed: ReadonlySet<string>,
): void {
  const value = source[key];
  if (typeof value === "string" && allowed.has(value)) {
    target[key] = value;
  }
}

function addCount(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: string,
): void {
  const value = source[key];
  if (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= 0
  ) {
    target[key] = value;
  }
}

function sanitizeItemCounts(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const itemCounts: Record<string, unknown> = {};
  for (const key of ITEM_COUNT_KEYS) {
    addCount(itemCounts, value, key);
  }
  return itemCounts;
}

function sanitizeProperties(
  eventName: TelemetryEventName,
  value: unknown,
): Record<string, unknown> {
  const source = isRecord(value) ? value : {};
  const properties: Record<string, unknown> = {};

  switch (eventName) {
    case "project_created":
      addEnum(properties, source, "profileType", PROFILE_TYPES);
      addCount(properties, source, "marketCount");
      addCount(properties, source, "languageCount");
      return properties;
    case "source_snapshot_ready":
      addEnum(properties, source, "provider", PROVIDERS);
      addEnum(properties, source, "availability", AVAILABILITIES);
      addCount(properties, source, "rowCount");
      addEnum(properties, source, "durationBucket", DURATION_BUCKETS);
      return properties;
    case "diagnostic_completed":
      addEnum(properties, source, "status", TERMINAL_RUN_STATUSES);
      addEnum(properties, source, "domainCoverage", AVAILABILITIES);
      addCount(properties, source, "findingCount");
      addEnum(properties, source, "durationBucket", DURATION_BUCKETS);
      return properties;
    case "action_confirmed":
      addEnum(properties, source, "ruleId", RULE_IDS);
      addEnum(properties, source, "priorityBand", PRIORITY_BANDS);
      addEnum(properties, source, "roadmapLane", ROADMAP_LANES);
      return properties;
    case "export_ready": {
      addEnum(properties, source, "kind", EXPORT_KINDS);
      const itemCounts = sanitizeItemCounts(source["itemCounts"]);
      if (itemCounts) properties["itemCounts"] = itemCounts;
      addEnum(properties, source, "sizeBucket", SIZE_BUCKETS);
      return properties;
    }
  }
}

export class TelemetryRepository extends Repository {
  /** Emit one telemetry event (inside the owning transaction). */
  async emit(values: {
    workspaceId: string;
    projectId: string | null;
    eventName: TelemetryEventName;
    actorId: string | null;
    properties: Record<string, unknown>;
  }): Promise<void> {
    await this.exec.insert(telemetryEvents).values({
      workspace_id: values.workspaceId,
      project_id: values.projectId,
      event_name: values.eventName,
      actor_id: values.actorId,
      properties: redact(
        sanitizeProperties(values.eventName, values.properties),
      ) as Record<string, unknown>,
    });
  }
}
