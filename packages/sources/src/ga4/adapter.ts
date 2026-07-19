/**
 * GA4 organic-landing source adapter (spec §7.4). Implements `SourceAdapter` for
 * provider "ga4": it drives two paginated GA4 reports through an injected
 * `Ga4Client`, guards the key-event report behind a compatibility check, and maps
 * everything to canonical `METRIC_GA4_LANDING` observations.
 *
 * The two reports (both filtered to the `Organic Search` default channel group):
 *   1. SESSION:   dims [date, landingPage]      metrics [sessions, engagedSessions, engagementRate]
 *   2. KEY-EVENT: dims [date, landingPage, eventName] metric [keyEvents] + eventName IN-filter
 *
 * Key-event honesty (spec §1.3, §7.4): no key events mapped → `unmapped`; the
 * compatibility check reports the event/metric incompatible → `incompatible`. In
 * both cases session rows are STILL collected and key events are `null` (never 0),
 * and the SNAPSHOT availability is `"partial"`.
 *
 * `now` and the property timezone are injected via params (never machine-local).
 */

import type {
  Availability,
  Capability,
  CollectionContext,
  CollectionResult,
  NormalizeContext,
  NormalizedObservation,
  Provider,
  SourceAdapter,
  SourceWindow,
} from "../adapter.ts";
import { SourceError } from "../adapter.ts";
import type {
  Ga4Client,
  Ga4Dimension,
  Ga4FilterExpression,
  Ga4Metric,
  Ga4ReportResponse,
  Ga4ReportRow,
  Ga4ReportStopReason,
} from "./client.ts";
import {
  GA4_MAX_ROWS,
  GA4_PAGINATION_CAP_LIMITATION,
  GA4_PAGINATION_CAP_STOP_REASON,
  GA4_ROW_CAP_LIMITATION,
  GA4_ROW_CAP_STOP_REASON,
} from "./client.ts";
import type {
  Ga4KeyEventRow,
  Ga4KeyEventStatus,
  Ga4SessionRow,
} from "./normalize.ts";
import {
  GA4_KEY_EVENT_UNMAPPED,
  GA4_LIMITATION,
  keyEventReason,
  normalizeGa4,
} from "./normalize.ts";
import type { Ga4Window } from "./window.ts";
import { computeGa4Window } from "./window.ts";

const GA4_PROVIDER: Provider = "ga4";
const GA4_ORGANIC_CHANNEL = "Organic Search";

const SESSION_DIMENSIONS: readonly Ga4Dimension[] = [{ name: "date" }, { name: "landingPage" }];
const SESSION_METRICS: readonly Ga4Metric[] = [
  { name: "sessions" },
  { name: "engagedSessions" },
  { name: "engagementRate" },
];
const KEY_EVENT_DIMENSIONS: readonly Ga4Dimension[] = [
  { name: "date" },
  { name: "landingPage" },
  { name: "eventName" },
];
const KEY_EVENT_METRICS: readonly Ga4Metric[] = [{ name: "keyEvents" }];

export interface Ga4AdapterOptions {
  /** Testable collection-wide cap; production cannot exceed the §7.2 maximum. */
  readonly maxRows?: number;
}

/** Validated GA4 connection config (spec §7.4). */
export interface Ga4Config {
  /** Property resource name, e.g. `properties/123456789`. */
  readonly propertyId: string;
  /** Operator-selected key event names (empty = no key events mapped). */
  readonly keyEventNames: readonly string[];
}

/** Parameters for one GA4 collection. `now`/`propertyTimeZone` are injected. */
export interface Ga4Params {
  readonly propertyId: string;
  readonly keyEventNames: readonly string[];
  /** Site origin (e.g. `https://example.com`) landing PATHS are resolved against. */
  readonly siteOrigin: string;
  /** GA4 property timezone (from property metadata; never machine-local). */
  readonly propertyTimeZone: string;
  /** Injected clock instant used to derive the window and capturedAt. */
  readonly now: Date;
}

/** The raw GA4 payload persisted verbatim as the snapshot (the `R`). */
export interface Ga4Raw {
  readonly propertyId: string;
  readonly propertyTimeZone: string;
  readonly siteOrigin: string;
  readonly window: Ga4Window;
  readonly sessionRows: readonly Ga4SessionRow[];
  readonly keyEventRows: readonly Ga4KeyEventRow[];
  readonly keyEventStatus: Ga4KeyEventStatus;
  readonly sessionReport: Ga4ReportMetadata;
  readonly keyEventReport: Ga4ReportMetadata | null;
  readonly availability: Availability;
  readonly stopReason: Ga4ReportStopReason | null;
  readonly limitation: string;
  readonly capturedAt: string;
}

export interface Ga4ReportMetadata {
  readonly reportedRowCount: number;
  readonly collectedRowCount: number;
  readonly truncated: boolean;
  readonly stopReason: Ga4ReportStopReason | null;
  readonly limitation: string;
}

// ---------------------------------------------------------------------------
// Config validation (hand-rolled — no external deps; spec §7.4).
// ---------------------------------------------------------------------------

function normalizePropertyId(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new SourceError("INVALID_CONFIGURATION", "GA4 propertyId must be a string");
  }
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return `properties/${trimmed}`;
  if (/^properties\/\d+$/.test(trimmed)) return trimmed;
  throw new SourceError(
    "INVALID_CONFIGURATION",
    "GA4 propertyId must be a numeric id or a `properties/{id}` resource name",
  );
}

function normalizeKeyEventNames(raw: unknown): readonly string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new SourceError("INVALID_CONFIGURATION", "GA4 keyEventNames must be an array");
  }
  const names: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      throw new SourceError("INVALID_CONFIGURATION", "GA4 keyEventNames must be strings");
    }
    const trimmed = item.trim();
    if (trimmed !== "" && !names.includes(trimmed)) names.push(trimmed);
  }
  return names;
}

// ---------------------------------------------------------------------------
// GA4 request builders.
// ---------------------------------------------------------------------------

function organicChannelFilter(): Ga4FilterExpression {
  return {
    filter: {
      fieldName: "sessionDefaultChannelGroup",
      stringFilter: { matchType: "EXACT", value: GA4_ORGANIC_CHANNEL },
    },
  };
}

function keyEventFilter(eventNames: readonly string[]): Ga4FilterExpression {
  return {
    andGroup: {
      expressions: [
        organicChannelFilter(),
        { filter: { fieldName: "eventName", inListFilter: { values: [...eventNames] } } },
      ],
    },
  };
}

// ---------------------------------------------------------------------------
// Row parsing (guarded for `noUncheckedIndexedAccess`).
// ---------------------------------------------------------------------------

function dimensionValue(row: Ga4ReportRow, index: number): string {
  const cell = row.dimensionValues[index];
  if (cell === undefined) {
    throw new SourceError("INVALID_RESPONSE", `GA4 row missing dimension ${index}`);
  }
  return cell.value;
}

function metricValue(row: Ga4ReportRow, index: number): string {
  const cell = row.metricValues[index];
  if (cell === undefined) {
    throw new SourceError("INVALID_RESPONSE", `GA4 row missing metric ${index}`);
  }
  return cell.value;
}

function toInt(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) {
    throw new SourceError("INVALID_RESPONSE", `GA4 non-integer metric value: ${value}`);
  }
  return parsed;
}

function toFloat(value: string): number {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    throw new SourceError("INVALID_RESPONSE", `GA4 non-numeric metric value: ${value}`);
  }
  return parsed;
}

/** GA4 returns dates as `YYYYMMDD`; canonicalize to `YYYY-MM-DD`. */
function formatGa4Date(raw: string): string {
  if (!/^\d{8}$/.test(raw)) {
    throw new SourceError("INVALID_RESPONSE", `GA4 malformed date dimension: ${raw}`);
  }
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

function parseSessionRows(response: Ga4ReportResponse): Ga4SessionRow[] {
  return response.rows.map((row) => ({
    date: formatGa4Date(dimensionValue(row, 0)),
    landingPage: dimensionValue(row, 1),
    sessions: toInt(metricValue(row, 0)),
    engagedSessions: toInt(metricValue(row, 1)),
    engagementRate: toFloat(metricValue(row, 2)),
  }));
}

function parseKeyEventRows(response: Ga4ReportResponse): Ga4KeyEventRow[] {
  return response.rows.map((row) => ({
    date: formatGa4Date(dimensionValue(row, 0)),
    landingPage: dimensionValue(row, 1),
    eventName: dimensionValue(row, 2),
    keyEvents: toInt(metricValue(row, 0)),
  }));
}

function maxCollectionRows(value: number | undefined): number {
  const maxRows = value ?? GA4_MAX_ROWS;
  if (!Number.isSafeInteger(maxRows) || maxRows <= 0 || maxRows > GA4_MAX_ROWS) {
    throw new SourceError(
      "INVALID_CONFIGURATION",
      `GA4 collection maxRows must be an integer between 1 and ${GA4_MAX_ROWS}.`,
    );
  }
  return maxRows;
}

function limitationForStopReason(stopReason: Ga4ReportStopReason): string {
  return stopReason === GA4_ROW_CAP_STOP_REASON
    ? GA4_ROW_CAP_LIMITATION
    : GA4_PAGINATION_CAP_LIMITATION;
}

/** Defend the adapter budget even when an alternate injected client is buggy. */
function enforceReportBudget(
  response: Ga4ReportResponse,
  maxRows: number,
): Ga4ReportResponse {
  if (!Number.isSafeInteger(response.rowCount) || response.rowCount < 0) {
    throw new SourceError("INVALID_RESPONSE", "GA4 report has an invalid rowCount.");
  }
  if (response.rowCount < response.rows.length) {
    throw new SourceError(
      "INVALID_RESPONSE",
      "GA4 report contains more rows than its reported rowCount.",
    );
  }

  const rows = response.rows.slice(0, maxRows);
  const exceededBudget = response.rows.length > maxRows;
  const silentlyIncomplete = !response.truncated && response.rowCount > rows.length;
  const truncated = response.truncated || exceededBudget || silentlyIncomplete;
  if (!truncated) {
    return { rows, rowCount: response.rowCount, truncated: false, stopReason: null, limitation: "" };
  }

  const stopReason = exceededBudget
    ? GA4_ROW_CAP_STOP_REASON
    : response.stopReason ?? GA4_PAGINATION_CAP_STOP_REASON;
  const limitation = response.limitation.trim() || limitationForStopReason(stopReason);
  return { rows, rowCount: response.rowCount, truncated: true, stopReason, limitation };
}

function reportMetadata(response: Ga4ReportResponse): Ga4ReportMetadata {
  return {
    reportedRowCount: response.rowCount,
    collectedRowCount: response.rows.length,
    truncated: response.truncated,
    stopReason: response.stopReason,
    limitation: response.limitation,
  };
}

function collectionStopReason(
  stopReasons: readonly Ga4ReportStopReason[],
): Ga4ReportStopReason | null {
  if (stopReasons.includes(GA4_ROW_CAP_STOP_REASON)) return GA4_ROW_CAP_STOP_REASON;
  return stopReasons[0] ?? null;
}

function collectionLimitation(
  keyEventStatus: Ga4KeyEventStatus,
  reportLimitations: readonly string[],
): string {
  const values = [keyEventReason(keyEventStatus.state) ?? GA4_LIMITATION, ...reportLimitations]
    .map((value) => value.trim())
    .filter((value, index, all) => value !== "" && all.indexOf(value) === index);
  return values.join(" ");
}

// ---------------------------------------------------------------------------
// Adapter factory.
// ---------------------------------------------------------------------------

/**
 * Build the GA4 adapter over an injected, token-bound `Ga4Client`. The worker
 * constructs an `HttpGa4Client` per connection and passes it here.
 */
export function createGa4Adapter(
  client: Ga4Client,
  options: Ga4AdapterOptions = {},
): SourceAdapter<Ga4Config, Ga4Params, Ga4Raw> {
  const maxRows = maxCollectionRows(options.maxRows);
  return {
    provider: GA4_PROVIDER,

    async validateConfig(config: unknown): Promise<Ga4Config> {
      if (typeof config !== "object" || config === null) {
        throw new SourceError("INVALID_CONFIGURATION", "GA4 config must be an object");
      }
      const record = config as Record<string, unknown>;
      return Object.freeze({
        propertyId: normalizePropertyId(record.propertyId),
        keyEventNames: normalizeKeyEventNames(record.keyEventNames),
      });
    },

    async capabilities(config: Ga4Config): Promise<Capability[]> {
      const hasKeyEvents = config.keyEventNames.length > 0;
      return [
        {
          datasetKey: "ga4.organic_landing_daily.v1",
          operation: "organic_landing",
          available: true,
          limitation: hasKeyEvents
            ? ""
            : `Key events unmapped; conversions unavailable (${GA4_KEY_EVENT_UNMAPPED}).`,
        },
      ];
    },

    async collect(
      params: Ga4Params,
      ctx: CollectionContext,
    ): Promise<CollectionResult<Ga4Raw>> {
      const window = computeGa4Window(params.now, params.propertyTimeZone);
      const capturedAt = params.now.toISOString();
      const dateRanges = [{ startDate: window.startDate, endDate: window.endDate }] as const;

      // 1. SESSION report — always collected.
      const sessionResponse = enforceReportBudget(await client.runReport(
        {
          dateRanges: [...dateRanges],
          dimensions: SESSION_DIMENSIONS,
          metrics: SESSION_METRICS,
          dimensionFilter: organicChannelFilter(),
        },
        ctx.signal,
        { maxRows },
      ), maxRows);
      const sessionRows = parseSessionRows(sessionResponse);
      const remainingRows = maxRows - sessionRows.length;
      const reportLimitations: string[] = [];
      const stopReasons: Ga4ReportStopReason[] = [];
      if (sessionResponse.truncated) {
        reportLimitations.push(sessionResponse.limitation);
        if (sessionResponse.stopReason) stopReasons.push(sessionResponse.stopReason);
      }

      // 2. KEY-EVENT report — behind an unmapped/compatibility gate (spec §7.4).
      let keyEventRows: readonly Ga4KeyEventRow[] = [];
      let keyEventStatus: Ga4KeyEventStatus;
      let keyEventResponse: Ga4ReportResponse | null = null;
      if (params.keyEventNames.length === 0) {
        keyEventStatus = { state: "unmapped" };
      } else if (remainingRows === 0) {
        keyEventStatus = { state: "truncated" };
        reportLimitations.push(GA4_ROW_CAP_LIMITATION);
        stopReasons.push(GA4_ROW_CAP_STOP_REASON);
      } else {
        const filter = keyEventFilter(params.keyEventNames);
        const compatibility = await client.checkCompatibility(
          { dimensions: KEY_EVENT_DIMENSIONS, metrics: KEY_EVENT_METRICS, dimensionFilter: filter },
          ctx.signal,
        );
        if (!compatibility.compatible) {
          keyEventStatus = { state: "incompatible" };
        } else {
          keyEventResponse = enforceReportBudget(await client.runReport(
            {
              dateRanges: [...dateRanges],
              dimensions: KEY_EVENT_DIMENSIONS,
              metrics: KEY_EVENT_METRICS,
              dimensionFilter: filter,
            },
            ctx.signal,
            { maxRows: remainingRows },
          ), remainingRows);
          keyEventRows = parseKeyEventRows(keyEventResponse);
          if (keyEventResponse.truncated) {
            keyEventStatus = { state: "truncated" };
            reportLimitations.push(keyEventResponse.limitation);
            if (keyEventResponse.stopReason) stopReasons.push(keyEventResponse.stopReason);
          } else {
            keyEventStatus = { state: "available" };
          }
        }
      }

      const stopReason = collectionStopReason(stopReasons);
      const availability: Availability =
        keyEventStatus.state === "available" && stopReason === null
          ? "available"
          : "partial";
      const limitation = collectionLimitation(keyEventStatus, reportLimitations);
      const raw: Ga4Raw = {
        propertyId: params.propertyId,
        propertyTimeZone: params.propertyTimeZone,
        siteOrigin: params.siteOrigin,
        window,
        sessionRows,
        keyEventRows,
        keyEventStatus,
        sessionReport: reportMetadata(sessionResponse),
        keyEventReport: keyEventResponse ? reportMetadata(keyEventResponse) : null,
        availability,
        stopReason,
        limitation,
        capturedAt,
      };
      const sourceWindow: SourceWindow = { start: window.startDate, end: window.endDate };

      return {
        availability,
        raw,
        capturedAt,
        sourceWindow,
        rowCount: sessionRows.length + keyEventRows.length,
        stopReason,
        providerUsage: {
          sessionRows: sessionRows.length,
          keyEventRows: keyEventRows.length,
        },
        limitation,
      };
    },

    async *normalize(
      raw: Ga4Raw,
      ctx: NormalizeContext,
    ): AsyncIterable<NormalizedObservation> {
      const observations = normalizeGa4(
        raw.sessionRows,
        raw.keyEventRows,
        raw.siteOrigin,
        raw.window,
        ctx.capturedAt,
        raw.keyEventStatus,
        raw.limitation,
      );
      for (const observation of observations) yield observation;
    },
  };
}
