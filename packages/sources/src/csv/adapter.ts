/**
 * The CSV keyword-gap `SourceAdapter` (spec §7.1, §7.5). Unlike the network
 * adapters, `collect` performs no IO: the confirm SERVICE has already parsed and
 * validated the upload during PREVIEW, so it hands the adapter the raw CSV text
 * plus the operator's confirmed mapping. `collect` wraps that into a
 * `CollectionResult<CsvRaw>`; `normalize` streams the confirm-phase observations
 * (via `normalizeCsv`). Row-level rejections are surfaced by calling
 * `normalizeCsv` directly (see wp2-csv-notes.md).
 */

import type {
  Capability,
  CollectionContext,
  CollectionResult,
  NormalizeContext,
  NormalizedObservation,
  Provider,
  SourceAdapter,
} from "../adapter.ts";
import { SourceError } from "../adapter.ts";
import { parseCsv } from "./parse.ts";
import { KEYWORD_GAP_TEMPLATE_ID } from "./preview.ts";
import {
  CSV_LIMITATION,
  normalizeCsv,
  type NormalizeCsvOptions,
} from "./normalize.ts";
import type { CsvColumnMapping } from "./mapping.ts";

const CSV_PROVIDER: Provider = "csv";

/** Validated CSV connection config. Only the keyword-gap template exists. */
export interface CsvConfig {
  readonly templateId: string;
}

/** Confirmed import content passed by the confirm service to `collect`. */
export interface CsvParams {
  readonly text: string;
  readonly mapping: CsvColumnMapping;
  readonly marketFallback?: string;
  readonly languageFallback?: string;
}

/** The raw payload persisted as the snapshot and mapped to observations. */
export interface CsvRaw {
  readonly text: string;
  readonly mapping: CsvColumnMapping;
  readonly marketFallback: string | null;
  readonly languageFallback: string | null;
  readonly rowCount: number;
  readonly capturedAt: string;
}

export const csvAdapter: SourceAdapter<CsvConfig, CsvParams, CsvRaw> = {
  provider: CSV_PROVIDER,

  async validateConfig(config: unknown): Promise<CsvConfig> {
    if (typeof config !== "object" || config === null) {
      throw new SourceError(
        "INVALID_CONFIGURATION",
        "csv config must be an object",
      );
    }
    const templateId = (config as { readonly templateId?: unknown }).templateId;
    if (templateId !== KEYWORD_GAP_TEMPLATE_ID) {
      throw new SourceError(
        "INVALID_CONFIGURATION",
        `unsupported csv templateId; expected "${KEYWORD_GAP_TEMPLATE_ID}"`,
      );
    }
    return { templateId: KEYWORD_GAP_TEMPLATE_ID };
  },

  async capabilities(_config: CsvConfig): Promise<Capability[]> {
    return [
      {
        datasetKey: "csv.keyword_gap.v1",
        operation: "keyword_gap_import",
        available: true,
        limitation: "",
      },
    ];
  },

  async collect(
    params: CsvParams,
    _ctx: CollectionContext,
  ): Promise<CollectionResult<CsvRaw>> {
    const { rows } = parseCsv(params.text);
    const rowCount = rows.length;
    const capturedAt = new Date().toISOString();
    const raw: CsvRaw = {
      text: params.text,
      mapping: params.mapping,
      marketFallback: params.marketFallback ?? null,
      languageFallback: params.languageFallback ?? null,
      rowCount,
      capturedAt,
    };
    return {
      availability: "available",
      raw,
      capturedAt,
      sourceWindow: { start: null, end: null },
      rowCount,
      stopReason: null,
      providerUsage: {},
      limitation: CSV_LIMITATION,
    };
  },

  async *normalize(
    raw: CsvRaw,
    ctx: NormalizeContext,
  ): AsyncGenerator<NormalizedObservation> {
    const options: NormalizeCsvOptions = {
      observedAt: ctx.capturedAt,
      ...(raw.marketFallback !== null
        ? { marketFallback: raw.marketFallback }
        : {}),
      ...(raw.languageFallback !== null
        ? { languageFallback: raw.languageFallback }
        : {}),
    };
    const { observations } = normalizeCsv(raw.text, raw.mapping, options);
    for (const observation of observations) {
      yield observation;
    }
  },
};
