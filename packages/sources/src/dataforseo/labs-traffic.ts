// @input  -- page-one provider domains plus the market/location/Labs language they ranked in
// @output -- chunked estimated monthly organic traffic with unresolved input identity intact
// @pos    -- the only caller of the DataForSEO Labs bulk-traffic endpoint
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { domainToASCII } from "node:url";
import { getDomain } from "tldts";
import {
  cancelResponseBody,
  createRequestAbortScope,
  DEFAULT_PROVIDER_MAX_RESPONSE_BYTES,
  DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
  readBoundedJson,
} from "../provider-http.ts";

export const DATAFORSEO_BULK_TRAFFIC_ESTIMATION_LIVE_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/bulk_traffic_estimation/live";

/** DataForSEO's documented maximum number of targets in one task. */
export const MAX_DATAFORSEO_BULK_TRAFFIC_TARGETS_PER_TASK = 1_000;

const SUCCESS_STATUS = 20_000;
const EMPTY_RESULT_STATUS = 40_102;

/**
 * Which Labs language code each shipped market resolves to.
 *
 * This is a positive list, and NOT the language the SERP call uses. Labs
 * serves Taiwan only as `zh-TW`, Norway only as `nb`, and no Labs location
 * serves bare `zh`. Sending the SERP pair to Labs buys a paid error.
 */
const LABS_LANGUAGE_BY_MARKET: Readonly<Record<string, string>> = {
  US: "en",
  GB: "en",
  CA: "en",
  AU: "en",
  IE: "en",
  NZ: "en",
  DE: "de",
  FR: "fr",
  ES: "es",
  IT: "it",
  NL: "nl",
  SE: "sv",
  NO: "nb",
  DK: "da",
  FI: "fi",
  PL: "pl",
  PT: "pt",
  BR: "pt",
  MX: "es",
  IN: "en",
  JP: "ja",
  KR: "ko",
  SG: "en",
  HK: "zh-TW",
  TW: "zh-TW",
  MY: "en",
  TH: "th",
  ID: "id",
  VN: "vi",
  PH: "en",
  AE: "en",
  ZA: "en",
  // CN is absent on purpose: Labs does not serve its location code.
};

/** The Labs language for a market, or null when Labs cannot serve it. */
export function labsLanguageForMarket(market: string): string | null {
  return LABS_LANGUAGE_BY_MARKET[market.trim().toUpperCase()] ?? null;
}

/**
 * Convert a provider hostname to an ASCII registrable-domain join key.
 *
 * Inputs are hostnames, never URLs: credentials, ports and paths are rejected
 * instead of being guessed away. `tldts` keeps multi-label public suffixes and
 * IDNs correct without a hand-maintained suffix table.
 */
export function normalizeTrafficDomain(value: string): string | null {
  const trimmed = value.trim();
  if (
    trimmed === "" ||
    trimmed.length > 253 ||
    /[\s/@:?#\\]/u.test(trimmed)
  ) {
    return null;
  }
  const ascii = domainToASCII(trimmed.replace(/\.$/u, "").toLowerCase());
  if (
    ascii === "" ||
    ascii.length > 253 ||
    !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(
      ascii,
    )
  ) {
    return null;
  }
  const domain = getDomain(ascii, { allowPrivateDomains: true });
  return domain === null ? null : domain.toLowerCase();
}

export interface DomainTrafficRow {
  /** First caller spelling represented by this deduplicated domain. */
  readonly target: string;
  /** ASCII registrable domain sent to and echoed by the provider. */
  readonly normalizedTarget: string;
  /** Provider estimate; null is unknown and numeric zero is measured zero. */
  readonly organicEtv: number | null;
}

export interface BulkTrafficEstimationResult {
  readonly rows: readonly DomainTrafficRow[];
  /** First caller spellings the provider returned no item for. */
  readonly unresolvedTargets: readonly string[];
  readonly costUsd: number;
  readonly batchCount: number;
  readonly providerStatusCodes: readonly number[];
  readonly taskStatusCodes: readonly number[];
}

export interface BulkTrafficEstimationOptions {
  readonly login: string;
  readonly password: string;
  readonly targets: readonly string[];
  /**
   * Required by v2 callers so the Labs language cannot drift from the market.
   * Optional only for the two pre-v2 internal callers during migration.
   */
  readonly marketCode?: string;
  readonly locationCode: number;
  /** Must come from `labsLanguageForMarket`, never from the SERP call. */
  readonly languageCode: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly signal?: AbortSignal;
  /** Books each parsed batch before a later batch can fail the aggregate. */
  readonly onCost?: (costUsd: number) => void;
}

interface RequestedTarget {
  readonly requested: string;
  readonly normalized: string;
}

interface ParsedTrafficBatch {
  readonly rowsByDomain: ReadonlyMap<string, number | null>;
  readonly costUsd: number;
  readonly providerStatusCode: number;
  readonly taskStatusCode: number;
}

type JsonRecord = Record<string, unknown>;

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function statusCode(value: unknown): number | null {
  return Number.isSafeInteger(value) ? (value as number) : null;
}

function acceptableStatus(value: number | null): value is number {
  return value === SUCCESS_STATUS || value === EMPTY_RESULT_STATUS;
}

function finiteCost(...values: readonly unknown[]): number | null {
  for (const value of values) {
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) {
      return value;
    }
  }
  return null;
}

function normalizeTargets(
  values: readonly string[],
): readonly RequestedTarget[] | null {
  if (!Array.isArray(values) || values.length === 0) return null;
  const seen = new Set<string>();
  const targets: RequestedTarget[] = [];
  for (const requested of values) {
    if (typeof requested !== "string") return null;
    const normalized = normalizeTrafficDomain(requested);
    if (normalized === null) return null;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    targets.push({ requested, normalized });
  }
  return targets.length === 0 ? null : targets;
}

function chunk<T>(values: readonly T[], size: number): readonly T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    batches.push(values.slice(index, index + size));
  }
  return batches;
}

function parseTrafficBatch(
  payload: unknown,
  requested: ReadonlySet<string>,
): ParsedTrafficBatch | null {
  const envelope = asRecord(payload);
  const providerStatusCode = statusCode(envelope?.["status_code"]);
  const tasks = envelope?.["tasks"];
  if (!acceptableStatus(providerStatusCode) || !Array.isArray(tasks)) {
    return null;
  }
  const task = asRecord(tasks[0]);
  const taskStatusCode = statusCode(task?.["status_code"]);
  if (!acceptableStatus(taskStatusCode)) return null;
  const costUsd = finiteCost(envelope?.["cost"], task?.["cost"]);
  if (costUsd === null) return null;

  const results = task?.["result"];
  const result = Array.isArray(results) ? asRecord(results[0]) : null;
  const rawItems = result?.["items"];
  if (rawItems !== undefined && rawItems !== null && !Array.isArray(rawItems)) {
    return null;
  }

  const rowsByDomain = new Map<string, number | null>();
  for (const rawItem of Array.isArray(rawItems) ? rawItems : []) {
    const item = asRecord(rawItem);
    const rawTarget = item?.["target"];
    if (typeof rawTarget !== "string") continue;
    const normalized = normalizeTrafficDomain(rawTarget);
    if (
      normalized === null ||
      !requested.has(normalized) ||
      rowsByDomain.has(normalized)
    ) {
      continue;
    }
    const metrics = asRecord(item?.["metrics"]);
    const organic = asRecord(metrics?.["organic"]);
    const etv = organic?.["etv"];
    rowsByDomain.set(
      normalized,
      typeof etv === "number" && Number.isFinite(etv) && etv >= 0
        ? etv
        : null,
    );
  }
  return {
    rowsByDomain,
    costUsd,
    providerStatusCode,
    taskStatusCode,
  };
}

function validRequest(options: BulkTrafficEstimationOptions): boolean {
  if (
    options.login.trim() === "" ||
    options.password.trim() === "" ||
    !Number.isSafeInteger(options.locationCode) ||
    options.locationCode <= 0 ||
    options.languageCode.trim() === ""
  ) {
    return false;
  }
  if (options.marketCode === undefined) return true;
  const expectedLanguage = labsLanguageForMarket(options.marketCode);
  return (
    expectedLanguage !== null &&
    expectedLanguage.toLowerCase() === options.languageCode.trim().toLowerCase()
  );
}

/**
 * Resolve estimated organic traffic for every distinct registrable domain.
 *
 * Batches run sequentially so request order and provider accounting are
 * deterministic. If any transport, provider status, or response body is
 * unusable, the whole lookup returns null rather than exposing partial data.
 */
export async function bulkTrafficEstimation(
  options: BulkTrafficEstimationOptions,
): Promise<BulkTrafficEstimationResult | null> {
  if (!validRequest(options)) return null;
  const targets = normalizeTargets(options.targets);
  if (targets === null) return null;

  const rowsByDomain = new Map<string, number | null>();
  const providerStatusCodes: number[] = [];
  const taskStatusCodes: number[] = [];
  let costUsd = 0;
  const batches = chunk(
    targets,
    MAX_DATAFORSEO_BULK_TRAFFIC_TARGETS_PER_TASK,
  );

  for (const batch of batches) {
    const abortScope = createRequestAbortScope(
      options.timeoutMs ?? DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS,
      [options.signal],
    );
    try {
      const response = await (options.fetchImpl ?? fetch)(
        DATAFORSEO_BULK_TRAFFIC_ESTIMATION_LIVE_URL,
        {
          method: "POST",
          redirect: "error",
          signal: abortScope.signal,
          headers: {
            Authorization: `Basic ${Buffer.from(
              `${options.login}:${options.password}`,
            ).toString("base64")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify([
            {
              targets: batch.map((target) => target.normalized),
              location_code: options.locationCode,
              language_code: options.languageCode.trim(),
            },
          ]),
        },
      );
      if (!response.ok) {
        await cancelResponseBody(response);
        return null;
      }
      const parsed = parseTrafficBatch(
        await readBoundedJson(
          response,
          options.maxResponseBytes ?? DEFAULT_PROVIDER_MAX_RESPONSE_BYTES,
          "DataForSEO bulk-traffic response",
          abortScope.signal,
        ),
        new Set(batch.map((target) => target.normalized)),
      );
      if (parsed === null) return null;
      options.onCost?.(parsed.costUsd);
      costUsd += parsed.costUsd;
      providerStatusCodes.push(parsed.providerStatusCode);
      taskStatusCodes.push(parsed.taskStatusCode);
      for (const [domain, etv] of parsed.rowsByDomain) {
        rowsByDomain.set(domain, etv);
      }
    } catch {
      return null;
    } finally {
      abortScope.cleanup();
    }
  }

  return {
    rows: targets.flatMap((target) => {
      if (!rowsByDomain.has(target.normalized)) return [];
      return [
        {
          target: target.requested,
          normalizedTarget: target.normalized,
          organicEtv: rowsByDomain.get(target.normalized) ?? null,
        },
      ];
    }),
    unresolvedTargets: targets
      .filter((target) => !rowsByDomain.has(target.normalized))
      .map((target) => target.requested),
    costUsd,
    batchCount: batches.length,
    providerStatusCodes,
    taskStatusCodes,
  };
}
