// @input  -- the domains already on page one, and the market they ranked in
// @output -- estimated monthly organic traffic per domain, or nothing
// @pos    -- the only caller of the DataForSEO Labs traffic endpoint
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

export const DATAFORSEO_BULK_TRAFFIC_ESTIMATION_LIVE_URL =
  "https://api.dataforseo.com/v3/dataforseo_labs/google/bulk_traffic_estimation/live";

/**
 * Which Labs language code each shipped market resolves to.
 *
 * A positive list, and NOT the language the SERP call uses. The two endpoints
 * are on different location tables: the SERP call normalises to a bare primary
 * subtag on purpose (`zh-CN` there is a paid error), while Labs serves
 * Taiwan only as `zh-TW`, Norway only as `nb`, and no Labs location anywhere
 * serves bare `zh`. Sending the SERP pair to Labs buys a paid error, not an
 * answer.
 *
 * A market absent from this table has no legal Labs pair at all, so the check
 * reports "not measurable in this market" rather than spending a call to be
 * told the same thing. Chinese mainland (2156) is the important one: it is not
 * in the Labs location list, and this product ships it deliberately.
 *
 * Keyed by market code so a rename in `SERP_LOCATIONS` cannot silently widen
 * this list; a market that appears there and not here simply goes unmeasured.
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
  // CN (2156) is absent on purpose and is the only shipped market missing:
  // Chinese mainland is not in the Labs location list at all, so no language
  // makes the pair legal. NO and TW ARE here because the blocker for them was
  // never the location — it was reusing the SERP call's bare primary subtag.
  // Labs serves Norway as `nb` and Taiwan as `zh-TW`, and neither as `no`/`zh`.
};

/**
 * The Labs language for a market, or null when Labs cannot serve it.
 *
 * Null is a settled answer: it means no request should be sent, and the check
 * should publish that this market is not covered rather than a zero.
 */
export function labsLanguageForMarket(market: string): string | null {
  return LABS_LANGUAGE_BY_MARKET[market.trim().toUpperCase()] ?? null;
}

export interface DomainTrafficRow {
  readonly target: string;
  /**
   * Estimated monthly organic visits, or null when the provider said nothing.
   *
   * Null and zero are kept apart deliberately. A domain the provider omitted
   * is a domain we know nothing about; reading that as zero traffic would
   * manufacture the very "low-traffic site on page one" that 9.3 looks for,
   * turning every provider gap into a false opportunity.
   */
  readonly organicEtv: number | null;
}

export interface BulkTrafficEstimationResult {
  readonly rows: readonly DomainTrafficRow[];
  /** Targets the provider returned nothing usable for. */
  readonly unresolvedTargets: readonly string[];
  /**
   * What the provider said this call cost, or null when it did not say.
   *
   * Null rather than zero for the same reason every other number here is:
   * this feeds the seam that exists to reconcile the invoice, and a response
   * whose shape moved would otherwise report a paid call as free. An
   * unreconcilable invoice is a worse outcome than a loud gap.
   */
  readonly costUsd: number | null;
}

/** The provider's own success code. Anything else is not a result. */
const LABS_SUCCESS_STATUS = 20_000;

interface LabsResponse {
  readonly status_code?: unknown;
  readonly cost?: unknown;
  readonly tasks?: readonly {
    readonly status_code?: unknown;
    readonly result?: readonly {
      readonly items?: readonly {
        readonly target?: unknown;
        readonly metrics?: {
          readonly organic?: { readonly etv?: unknown };
        };
      }[];
    }[];
  }[];
}

export interface BulkTrafficEstimationOptions {
  readonly login: string;
  readonly password: string;
  readonly targets: readonly string[];
  readonly locationCode: number;
  /** Must come from `labsLanguageForMarket`, never from the SERP call. */
  readonly languageCode: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
}

/**
 * One call for every domain on page one.
 *
 * The endpoint takes up to a thousand targets per task, so ten domains is one
 * request, not ten. Failure returns null rather than throwing: the SERP sample
 * this joins onto has already been paid for, and losing it to a second
 * provider's outage would trade what the visitor asked for against what they
 * did not.
 */
export async function bulkTrafficEstimation(
  options: BulkTrafficEstimationOptions,
): Promise<BulkTrafficEstimationResult | null> {
  const targets = [...new Set(options.targets)].filter((t) => t.trim() !== "");
  if (targets.length === 0) return null;
  // No credential, no request. Without this the empty-string default that every
  // caller falls back to still produces a well-formed Basic header, so a test
  // that injects a fake SERP client but forgets this one reaches the live paid
  // endpoint — silently on a machine that has the real credentials in its
  // environment. The guard belongs here rather than in each caller because it
  // is the callers forgetting that is the failure mode.
  if (options.login.trim() === "" || options.password.trim() === "")
    return null;

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 15_000,
  );
  try {
    const response = await (options.fetchImpl ?? fetch)(
      DATAFORSEO_BULK_TRAFFIC_ESTIMATION_LIVE_URL,
      {
        method: "POST",
        signal: controller.signal,
        headers: {
          authorization: `Basic ${Buffer.from(
            `${options.login}:${options.password}`,
          ).toString("base64")}`,
          "content-type": "application/json",
        },
        body: JSON.stringify([
          {
            targets,
            location_code: options.locationCode,
            language_code: options.languageCode,
          },
        ]),
      },
    );
    if (!response.ok) return null;
    const body = (await response.json()) as LabsResponse;
    // HTTP 200 is not provider success. DataForSEO answers authorization
    // failures, exhausted balance, rate limiting and malformed task parameters
    // with a 200 carrying an error `status_code`, and the tasks array then has
    // no `result`. Reading only `response.ok` turns every one of those into
    // "the provider sized zero domains", which 9.3 would go on to read as a
    // page one where nothing could be measured — a provider outage wearing a
    // measurement's clothes. The envelope and the task each carry their own
    // code and either can fail alone, so both are checked.
    const task = body.tasks?.[0];
    if (
      body.status_code !== LABS_SUCCESS_STATUS ||
      task === undefined ||
      task.status_code !== LABS_SUCCESS_STATUS
    ) {
      return null;
    }
    const items = task.result?.[0]?.items ?? [];

    const rows: DomainTrafficRow[] = [];
    const seen = new Set<string>();
    for (const item of items) {
      const target = item.target;
      if (typeof target !== "string" || target.trim() === "") continue;
      const etv = item.metrics?.organic?.etv;
      seen.add(target.toLowerCase());
      rows.push({
        target,
        organicEtv:
          typeof etv === "number" && Number.isFinite(etv) && etv >= 0
            ? etv
            : null,
      });
    }
    return {
      rows,
      unresolvedTargets: targets.filter((t) => !seen.has(t.toLowerCase())),
      costUsd:
        typeof body.cost === "number" &&
        Number.isFinite(body.cost) &&
        body.cost >= 0
          ? body.cost
          : null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
