import type {
  AsyncRunRow,
  DataSnapshotRow,
  SourceConnectionRow,
} from "@sf/db";
import { toAsyncRunDto, type AsyncRunDto } from "./runs";

/**
 * Source-domain row → DTO mappers (spec §7, §11). Shapes match the OpenAPI
 * `SourceConnection` and `DataSnapshot` schemas exactly. `connected` never
 * implies `available`: the effective display state downgrades to `stale` when the
 * latest snapshot is past its provider freshness window (spec §5.2).
 */

export interface SourceWindowDto {
  start: string | null;
  end: string | null;
}

export interface DataSnapshotDto {
  id: string;
  siteId: string;
  provider: string;
  datasetKey: string;
  schemaVersion: string;
  methodVersion: string;
  capturedAt: string;
  sourceWindow: SourceWindowDto;
  availability: string;
  limitation: string;
  rowCount: number;
  checksum: string;
}

export interface SourceConnectionDto {
  id: string | null;
  projectId: string;
  provider: string;
  connectionType: string;
  state: string;
  externalRef: string | null;
  scopes: string[];
  connectedAt: string | null;
  latestSnapshot: DataSnapshotDto | null;
  activeRun: AsyncRunDto | null;
  limitation: string;
  featureEnabled: boolean;
  updatedAt: string;
}

/** Snapshot freshness windows in days (spec §5.2). Past this ⇒ UI `stale`. */
const FRESHNESS_DAYS: Record<string, number> = {
  crawl: 7,
  gsc: 3,
  ga4: 3,
  csv: 30,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function readWindow(raw: Record<string, unknown>): SourceWindowDto {
  const start = typeof raw["start"] === "string" ? raw["start"] : null;
  const end = typeof raw["end"] === "string" ? raw["end"] : null;
  return { start, end };
}

export function toDataSnapshotDto(row: DataSnapshotRow): DataSnapshotDto {
  return {
    id: row.id,
    siteId: row.site_id,
    provider: row.provider,
    datasetKey: row.dataset_key,
    schemaVersion: row.schema_version,
    methodVersion: row.method_version,
    capturedAt: row.captured_at,
    sourceWindow: readWindow(row.source_window),
    availability: row.availability,
    limitation: row.limitation,
    rowCount: row.row_count,
    checksum: row.checksum,
  };
}

/** True when a snapshot is older than its provider's freshness window. */
export function isStale(provider: string, capturedAt: string, now: number): boolean {
  const days = FRESHNESS_DAYS[provider];
  if (days === undefined) return false;
  const captured = Date.parse(capturedAt);
  if (Number.isNaN(captured)) return false;
  return now - captured > days * DAY_MS;
}

/**
 * Map a live connection + its latest snapshot + active run into a DTO. The
 * effective `state`: if the stored state is available/partial but the latest
 * snapshot is stale (or absent when the state claims availability), show `stale`.
 */
export function toSourceConnectionDto(input: {
  projectId: string;
  provider: string;
  connection: SourceConnectionRow | null;
  latestSnapshot: DataSnapshotRow | null;
  activeRun: AsyncRunRow | null;
  featureEnabled: boolean;
  now: number;
}): SourceConnectionDto {
  const { connection, latestSnapshot, activeRun } = input;
  const snapshotDto = latestSnapshot ? toDataSnapshotDto(latestSnapshot) : null;

  let state = connection ? connection.state : "connecting";
  if (connection && (state === "available" || state === "partial")) {
    if (!latestSnapshot || isStale(input.provider, latestSnapshot.captured_at, input.now)) {
      state = "stale";
    }
  }

  return {
    id: connection ? connection.id : null,
    projectId: input.projectId,
    provider: input.provider,
    connectionType: connection ? connection.connection_type : slotConnectionType(input.provider),
    state: connection ? state : "disconnected",
    externalRef: connection ? connection.external_ref : null,
    scopes: connection ? connection.scopes : [],
    connectedAt: connection ? connection.connected_at : null,
    latestSnapshot: snapshotDto,
    activeRun: activeRun ? toAsyncRunDto(activeRun) : null,
    limitation: connection
      ? connection.limitation
      : defaultLimitation(input.provider, input.featureEnabled),
    featureEnabled: input.featureEnabled,
    updatedAt: connection ? connection.updated_at : new Date(input.now).toISOString(),
  };
}

function slotConnectionType(provider: string): string {
  if (provider === "crawl") return "public";
  if (provider === "gsc" || provider === "ga4") return "oauth";
  if (provider === "csv") return "file_import";
  return "api_key_stub";
}

function defaultLimitation(provider: string, featureEnabled: boolean): string {
  switch (provider) {
    case "gsc":
      return "Not connected. Authorize Google Search Console to collect search performance data.";
    case "ga4":
      return "Not connected. Authorize Google Analytics 4 to collect organic landing data.";
    case "csv":
      return "No keyword-gap CSV imported yet.";
    case "dataforseo":
      return featureEnabled
        ? "DataForSEO ranked-keyword collection is enabled for the primary site. No snapshot has been collected yet."
        : "DataForSEO is disabled for this deployment.";
    default:
      return "No snapshot has been collected yet.";
  }
}
