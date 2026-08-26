// @input  -- sessionStorage-like access, the current time, and one private tool handoff
// @output -- a one-time, tab-scoped handoff between connected tools without URL leakage
// @pos    -- the only browser storage used for private connected-tool navigation

export const TOOL_HANDOFF_KEY = "gengrowth.tool-handoff.v1";
export const TOOL_HANDOFF_TTL_MS = 10 * 60 * 1_000;

export type ToolHandoffDestination =
  | "seo-quick-wins"
  | "traffic-drop-diagnosis"
  | "on-page-seo-check";

export interface ToolHandoffStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

export type ToolHandoffPayload =
  | {
      readonly source: "daily-search-briefing";
      readonly destination: ToolHandoffDestination;
      readonly scope: "query_page";
      readonly property: string;
      readonly query: string;
      readonly page: string;
      readonly evidenceId: string;
    }
  | {
      readonly source: "daily-search-briefing";
      readonly destination: Exclude<
        ToolHandoffDestination,
        "on-page-seo-check"
      >;
      readonly scope: "property";
      readonly property: string;
      readonly query: null;
      readonly page: null;
      readonly evidenceId: string;
    }
  | {
      readonly source: "competitor-keyword-gap";
      readonly destination: "on-page-seo-check";
      readonly scope: "query_page";
      readonly property: string;
      readonly query: string;
      readonly page: string;
      readonly evidenceId: string;
      readonly marketCode: string;
      readonly languageCode: string;
    }
  // The Opportunity Finder consumer selects a granted property and reads
  // nothing else off the handoff, so this variant carries no query and no page.
  // Sending one anyway would put a keyword on the wire that no surface reads,
  // and would let a reader believe the destination had been narrowed to it.
  | {
      readonly source: "competitor-keyword-gap";
      readonly destination: "seo-quick-wins";
      readonly scope: "property";
      readonly property: string;
      readonly query: null;
      readonly page: null;
      readonly evidenceId: string;
      readonly marketCode: string;
      readonly languageCode: string;
    };

export type ToolHandoff = ToolHandoffPayload & {
  readonly createdAt: number;
  readonly expiresAt: number;
};

const MAX_PROPERTY_LENGTH = 512;
const MAX_QUERY_LENGTH = 512;
const MAX_PAGE_LENGTH = 2_048;
const MAX_EVIDENCE_ID_LENGTH = 256;
const DAILY_BRIEFING_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  "source",
  "destination",
  "scope",
  "property",
  "query",
  "page",
  "evidenceId",
]);
const COMPETITOR_GAP_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  ...DAILY_BRIEFING_PAYLOAD_KEYS,
  "marketCode",
  "languageCode",
]);
const DAILY_BRIEFING_HANDOFF_KEYS: ReadonlySet<string> = new Set([
  ...DAILY_BRIEFING_PAYLOAD_KEYS,
  "createdAt",
  "expiresAt",
]);
const COMPETITOR_GAP_HANDOFF_KEYS: ReadonlySet<string> = new Set([
  ...COMPETITOR_GAP_PAYLOAD_KEYS,
  "createdAt",
  "expiresAt",
]);
const MARKET_CODE = /^[A-Z]{2}$/u;
const LANGUAGE_CODE = /^[a-z]{2}$/u;

function isDestination(value: unknown): value is ToolHandoffDestination {
  return (
    value === "seo-quick-wins" ||
    value === "traffic-drop-diagnosis" ||
    value === "on-page-seo-check"
  );
}

function isPropertyDestination(
  value: unknown,
): value is Exclude<ToolHandoffDestination, "on-page-seo-check"> {
  return value === "seo-quick-wins" || value === "traffic-drop-diagnosis";
}

function isFiniteTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function nonEmptyString(value: unknown, maxLength: number): value is string {
  return (
    typeof value === "string" &&
    value.trim() !== "" &&
    value.length <= maxLength
  );
}

function isObject(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.size && keys.every((key) => expected.has(key));
}

function payloadKeysFor(
  value: Readonly<Record<string, unknown>>,
): ReadonlySet<string> | null {
  if (value.source === "daily-search-briefing") {
    return DAILY_BRIEFING_PAYLOAD_KEYS;
  }
  if (value.source === "competitor-keyword-gap") {
    return COMPETITOR_GAP_PAYLOAD_KEYS;
  }
  return null;
}

function handoffKeysFor(
  value: Readonly<Record<string, unknown>>,
): ReadonlySet<string> | null {
  if (value.source === "daily-search-briefing") {
    return DAILY_BRIEFING_HANDOFF_KEYS;
  }
  if (value.source === "competitor-keyword-gap") {
    return COMPETITOR_GAP_HANDOFF_KEYS;
  }
  return null;
}

function isSafeHttpPage(value: unknown): value is string {
  if (!nonEmptyString(value, MAX_PAGE_LENGTH)) return false;
  try {
    const page = new URL(value.trim());
    return (
      (page.protocol === "http:" || page.protocol === "https:") &&
      page.hostname !== "" &&
      page.username === "" &&
      page.password === ""
    );
  } catch {
    return false;
  }
}

/**
 * A gap keyword's numbers only mean anything inside the market they were read
 * in, so every destination carries it. Checked apart from the target below so
 * that adding a destination cannot quietly ship a handoff without a market.
 */
function hasValidGapMarket(value: Readonly<Record<string, unknown>>): boolean {
  return (
    typeof value.marketCode === "string" &&
    MARKET_CODE.test(value.marketCode) &&
    typeof value.languageCode === "string" &&
    LANGUAGE_CODE.test(value.languageCode)
  );
}

/**
 * The destination decides the scope rather than the two being free to disagree.
 * On-Page audits one URL and needs both a query and a real page; the
 * Opportunity Finder only ever picks a property, and a query or page carried
 * there would be a value nothing reads. Any other destination is rejected: the
 * gap tool has no third handoff, and defaulting one open would let a forged
 * payload reach a tool that was never designed to receive gap context.
 */
function hasValidGapTarget(value: Readonly<Record<string, unknown>>): boolean {
  if (value.destination === "on-page-seo-check") {
    return (
      value.scope === "query_page" &&
      nonEmptyString(value.query, MAX_QUERY_LENGTH) &&
      isSafeHttpPage(value.page)
    );
  }
  if (value.destination === "seo-quick-wins") {
    return (
      value.scope === "property" && value.query === null && value.page === null
    );
  }
  return false;
}

function hasValidPayloadFields(
  value: Readonly<Record<string, unknown>>,
): boolean {
  if (
    !nonEmptyString(value.property, MAX_PROPERTY_LENGTH) ||
    !nonEmptyString(value.evidenceId, MAX_EVIDENCE_ID_LENGTH)
  ) {
    return false;
  }

  if (value.source === "competitor-keyword-gap") {
    return hasValidGapMarket(value) && hasValidGapTarget(value);
  }

  if (value.source === "daily-search-briefing") {
    if (value.scope === "query_page") {
      return (
        isDestination(value.destination) &&
        nonEmptyString(value.query, MAX_QUERY_LENGTH) &&
        nonEmptyString(value.page, MAX_PAGE_LENGTH)
      );
    }

    if (value.scope === "property") {
      return (
        isPropertyDestination(value.destination) &&
        value.query === null &&
        value.page === null
      );
    }
  }

  return false;
}

function isToolHandoff(value: unknown): value is ToolHandoff {
  if (!isObject(value)) return false;
  const expectedKeys = handoffKeysFor(value);
  if (expectedKeys === null || !hasExactKeys(value, expectedKeys)) return false;
  return (
    hasValidPayloadFields(value) &&
    isFiniteTimestamp(value.createdAt) &&
    isFiniteTimestamp(value.expiresAt) &&
    value.expiresAt > value.createdAt &&
    value.expiresAt - value.createdAt <= TOOL_HANDOFF_TTL_MS
  );
}

/**
 * A property-scoped handoff stores explicit nulls rather than trimmed empty
 * strings, so a consumer can tell "no query was carried" from "a query was
 * carried and it was blank". Split from the briefing builder because the two
 * sources carry different fields, and one builder for both would have to widen
 * the stored shape past what either source actually sends.
 */
function toGapHandoff(
  payload: Extract<ToolHandoffPayload, { source: "competitor-keyword-gap" }>,
  now: number,
): ToolHandoff {
  const shared = {
    source: payload.source,
    property: payload.property.trim(),
    evidenceId: payload.evidenceId.trim(),
    marketCode: payload.marketCode,
    languageCode: payload.languageCode,
    createdAt: now,
    expiresAt: now + TOOL_HANDOFF_TTL_MS,
  } as const;

  return payload.destination === "on-page-seo-check"
    ? {
        ...shared,
        destination: payload.destination,
        scope: payload.scope,
        query: payload.query.trim(),
        page: payload.page.trim(),
      }
    : {
        ...shared,
        destination: payload.destination,
        scope: payload.scope,
        query: null,
        page: null,
      };
}

function toBriefingHandoff(
  payload: Extract<ToolHandoffPayload, { source: "daily-search-briefing" }>,
  now: number,
): ToolHandoff {
  const shared = {
    source: payload.source,
    property: payload.property.trim(),
    evidenceId: payload.evidenceId.trim(),
    createdAt: now,
    expiresAt: now + TOOL_HANDOFF_TTL_MS,
  } as const;

  return payload.scope === "query_page"
    ? {
        ...shared,
        destination: payload.destination,
        scope: payload.scope,
        query: payload.query.trim(),
        page: payload.page.trim(),
      }
    : {
        ...shared,
        destination: payload.destination,
        scope: payload.scope,
        query: null,
        page: null,
      };
}

export function writeToolHandoff(
  storage: ToolHandoffStorage,
  now: number,
  payload: ToolHandoffPayload,
): boolean {
  const expectedKeys = isObject(payload) ? payloadKeysFor(payload) : null;
  if (
    !Number.isFinite(now) ||
    !isObject(payload) ||
    expectedKeys === null ||
    !hasExactKeys(payload, expectedKeys) ||
    !hasValidPayloadFields(payload)
  ) {
    return false;
  }

  const handoff: ToolHandoff =
    payload.source === "competitor-keyword-gap"
      ? toGapHandoff(payload, now)
      : toBriefingHandoff(payload, now);

  try {
    storage.setItem(TOOL_HANDOFF_KEY, JSON.stringify(handoff));
    return true;
  } catch {
    return false;
  }
}

export function consumeToolHandoff(
  storage: ToolHandoffStorage,
  now: number,
  destination: ToolHandoffDestination,
): ToolHandoff | null {
  try {
    const raw = storage.getItem(TOOL_HANDOFF_KEY);
    if (raw === null) return null;

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      storage.removeItem(TOOL_HANDOFF_KEY);
      return null;
    }

    if (!isToolHandoff(parsed)) {
      storage.removeItem(TOOL_HANDOFF_KEY);
      return null;
    }
    if (
      !Number.isFinite(now) ||
      parsed.createdAt > now ||
      parsed.expiresAt <= now
    ) {
      storage.removeItem(TOOL_HANDOFF_KEY);
      return null;
    }
    if (parsed.destination !== destination) return null;

    storage.removeItem(TOOL_HANDOFF_KEY);
    return parsed;
  } catch {
    return null;
  }
}
