/**
 * GSC source adapter (spec §7.1, §7.4). Wraps the `GscClient` seam and the pure
 * window/normalize transforms into the `SourceAdapter` contract. Because live
 * OAuth credentials are deferred, `collect` never constructs its own client:
 * `createGscAdapter(client)` binds a token-bound client the worker builds, so
 * the secret never enters this module. The default `gscAdapter` export carries
 * the same `validateConfig` / `capabilities` / `normalize` behaviour but its
 * `collect` fails with `AUTH_REQUIRED` until a real client is injected.
 */

import { SourceError } from "../adapter.ts";
import type {
  Availability,
  Capability,
  CollectionContext,
  CollectionOperation,
  CollectionResult,
  DatasetKey,
  NormalizeContext,
  NormalizedObservation,
  SourceAdapter,
} from "../adapter.ts";
import { GSC_MAX_ROWS } from "./client.ts";
import type { GscClient, GscRow } from "./client.ts";
import { GSC_LIMITATION, normalizeGscRows } from "./normalize.ts";
import { computeGscWindow } from "./window.ts";
import type { GscWindow } from "./window.ts";

const GSC_DATASET_KEY: DatasetKey = "gsc.page_query_daily.v1";
const GSC_OPERATION: CollectionOperation = "search_analytics";

/** Validated GSC connection config. `propertyUrl` is the verified GSC property id. */
export interface GscConfig {
  readonly propertyUrl: string;
}

/** Parameters for one GSC collection. `now`/`timeZone` are injectable for tests. */
export interface GscParams {
  readonly now?: Date;
  readonly timeZone?: string;
  /** Recorded on the raw payload for provenance; the client already knows the site. */
  readonly propertyUrl?: string;
}

/** The raw GSC payload (`R`): rows + the resolved window, persisted verbatim. */
export interface GscRaw {
  readonly propertyUrl: string | null;
  readonly window: GscWindow;
  readonly rows: readonly GscRow[];
  readonly rowCount: number;
  readonly truncated: boolean;
  readonly availability: Availability;
  readonly capturedAt: string;
  readonly stopReason: string | null;
}

async function validateConfig(config: unknown): Promise<GscConfig> {
  if (typeof config !== "object" || config === null) {
    throw new SourceError("INVALID_CONFIGURATION", "GSC config must be an object with a propertyUrl.");
  }
  const propertyUrl = (config as { readonly propertyUrl?: unknown }).propertyUrl;
  if (typeof propertyUrl !== "string" || propertyUrl.trim() === "") {
    throw new SourceError("INVALID_CONFIGURATION", "GSC config.propertyUrl must be a non-empty string.");
  }
  return { propertyUrl: propertyUrl.trim() };
}

async function capabilities(_config: GscConfig): Promise<Capability[]> {
  return [
    {
      datasetKey: GSC_DATASET_KEY,
      operation: GSC_OPERATION,
      available: true,
      limitation: GSC_LIMITATION,
    },
  ];
}

/**
 * Build a GSC adapter bound to `client`. The worker constructs an
 * `HttpGscClient` with the connection's site + access token and passes it here.
 */
export function createGscAdapter(client: GscClient): SourceAdapter<GscConfig, GscParams, GscRaw> {
  return {
    provider: "gsc",
    validateConfig,
    capabilities,

    async collect(params: GscParams, _ctx: CollectionContext): Promise<CollectionResult<GscRaw>> {
      const now = params.now ?? new Date();
      const window = computeGscWindow(now, params.timeZone);
      const rows = await client.querySearchAnalytics({
        startDate: window.startDate,
        endDate: window.endDate,
      });

      const truncated = rows.length >= GSC_MAX_ROWS;
      const availability: Availability = truncated ? "partial" : "available";
      const stopReason = truncated ? "row_cap_reached" : null;
      const capturedAt = now.toISOString();

      const raw: GscRaw = {
        propertyUrl: params.propertyUrl ?? null,
        window,
        rows,
        rowCount: rows.length,
        truncated,
        availability,
        capturedAt,
        stopReason,
      };

      return {
        availability,
        raw,
        capturedAt,
        sourceWindow: { start: window.startDate, end: window.endDate },
        rowCount: rows.length,
        stopReason,
        providerUsage: { rows: rows.length },
        limitation: GSC_LIMITATION,
      };
    },

    async *normalize(raw: GscRaw, ctx: NormalizeContext): AsyncIterable<NormalizedObservation> {
      for (const observation of normalizeGscRows(raw.rows, raw.window, ctx.capturedAt)) {
        yield observation;
      }
    },
  };
}

/** A client that refuses to collect until the worker injects a token-bound one. */
const unboundClient: GscClient = {
  querySearchAnalytics(): Promise<readonly GscRow[]> {
    return Promise.reject(
      new SourceError(
        "AUTH_REQUIRED",
        "GSC collection requires a token-bound client; construct the adapter with createGscAdapter(client).",
      ),
    );
  },
};

/**
 * Default adapter instance (provider "gsc"). `validateConfig`, `capabilities`,
 * and `normalize` work standalone; `collect` throws `AUTH_REQUIRED` until the
 * worker supplies a real client via `createGscAdapter`.
 */
export const gscAdapter: SourceAdapter<GscConfig, GscParams, GscRaw> = createGscAdapter(unboundClient);
