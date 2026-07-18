/**
 * The engine's read model of a complete ICP profile (spec §6.2). The diagnostic
 * run freezes the profile jsonb; this parser projects the fields the 11 rules
 * consume. It reads defensively (the profile was already validated on save) and
 * never throws — missing arrays become empty.
 */

export type CustomerModel = "b2b" | "b2c" | "hybrid";

export interface EngineConversion {
  readonly label: string;
  readonly type: string;
  readonly targetUrl: string | null;
}

export interface EngineIcp {
  readonly productName: string;
  readonly oneLineDescription: string;
  readonly customerModel: CustomerModel | null;
  readonly businessProfile: string | null;
  readonly marketCodes: readonly string[];
  readonly siteLanguageCodes: readonly string[];
  readonly defaultDeliveryLocale: string;
  readonly segments: readonly string[];
  readonly useCases: readonly string[];
  readonly offers: readonly string[];
  readonly differentiators: readonly string[];
  readonly primaryConversion: EngineConversion | null;
  readonly priorityProductsOrServices: readonly string[];
  readonly priorityUrls: readonly string[];
  readonly competitors: readonly string[];
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

function parseConversion(v: unknown): EngineConversion | null {
  if (typeof v !== "object" || v === null) return null;
  const o = v as Record<string, unknown>;
  return {
    label: str(o["label"]),
    type: str(o["type"]),
    targetUrl: typeof o["targetUrl"] === "string" ? o["targetUrl"] : null,
  };
}

export function parseIcp(profile: unknown): EngineIcp {
  const p = (typeof profile === "object" && profile !== null ? profile : {}) as Record<
    string,
    unknown
  >;
  const customerModel = str(p["customerModel"]);
  return {
    productName: str(p["productName"]),
    oneLineDescription: str(p["oneLineDescription"]),
    customerModel:
      customerModel === "b2b" || customerModel === "b2c" || customerModel === "hybrid"
        ? customerModel
        : null,
    businessProfile: typeof p["businessProfile"] === "string" ? p["businessProfile"] : null,
    marketCodes: strArray(p["marketCodes"]),
    siteLanguageCodes: strArray(p["siteLanguageCodes"]),
    defaultDeliveryLocale: str(p["defaultDeliveryLocale"], "en"),
    segments: strArray(p["segments"]),
    useCases: strArray(p["useCases"]),
    offers: strArray(p["offers"]),
    differentiators: strArray(p["differentiators"]),
    primaryConversion: parseConversion(p["primaryConversion"]),
    priorityProductsOrServices: strArray(p["priorityProductsOrServices"]),
    priorityUrls: strArray(p["priorityUrls"]),
    competitors: strArray(p["competitors"]),
  };
}

/**
 * Whether the project's primary site language is English (spec §8.4). Regex/
 * heuristic rules (intent match, proof block) only run for English projects;
 * otherwise they return `inconclusive` rather than manufacturing a defect.
 */
export function isEnglishProject(icp: EngineIcp): boolean {
  const primary = icp.siteLanguageCodes[0] ?? icp.defaultDeliveryLocale;
  return primary.toLowerCase().startsWith("en");
}
