// @input  -- sessionStorage-like access, the current time, and one private tool handoff
// @output -- a one-time, tab-scoped handoff between connected tools without URL leakage
// @pos    -- the only browser storage used for Daily Briefing cross-tool navigation

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
    };

export type ToolHandoff = ToolHandoffPayload & {
  readonly createdAt: number;
  readonly expiresAt: number;
};

const MAX_PROPERTY_LENGTH = 512;
const MAX_QUERY_LENGTH = 512;
const MAX_PAGE_LENGTH = 2_048;
const MAX_EVIDENCE_ID_LENGTH = 256;
const PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  "source",
  "destination",
  "scope",
  "property",
  "query",
  "page",
  "evidenceId",
]);
const HANDOFF_KEYS: ReadonlySet<string> = new Set([
  ...PAYLOAD_KEYS,
  "createdAt",
  "expiresAt",
]);

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

function hasValidPayloadFields(
  value: Readonly<Record<string, unknown>>,
): boolean {
  if (
    value.source !== "daily-search-briefing" ||
    !nonEmptyString(value.property, MAX_PROPERTY_LENGTH) ||
    !nonEmptyString(value.evidenceId, MAX_EVIDENCE_ID_LENGTH)
  ) {
    return false;
  }

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

  return false;
}

function isToolHandoff(value: unknown): value is ToolHandoff {
  if (!isObject(value) || !hasExactKeys(value, HANDOFF_KEYS)) return false;
  return (
    hasValidPayloadFields(value) &&
    isFiniteTimestamp(value.createdAt) &&
    isFiniteTimestamp(value.expiresAt) &&
    value.expiresAt > value.createdAt &&
    value.expiresAt - value.createdAt <= TOOL_HANDOFF_TTL_MS
  );
}

export function writeToolHandoff(
  storage: ToolHandoffStorage,
  now: number,
  payload: ToolHandoffPayload,
): boolean {
  if (
    !Number.isFinite(now) ||
    !isObject(payload) ||
    !hasExactKeys(payload, PAYLOAD_KEYS) ||
    !hasValidPayloadFields(payload)
  ) {
    return false;
  }

  const handoff: ToolHandoff =
    payload.scope === "query_page"
      ? {
          source: payload.source,
          destination: payload.destination,
          scope: payload.scope,
          property: payload.property.trim(),
          query: payload.query.trim(),
          page: payload.page.trim(),
          evidenceId: payload.evidenceId.trim(),
          createdAt: now,
          expiresAt: now + TOOL_HANDOFF_TTL_MS,
        }
      : {
          source: payload.source,
          destination: payload.destination,
          scope: payload.scope,
          property: payload.property.trim(),
          query: null,
          page: null,
          evidenceId: payload.evidenceId.trim(),
          createdAt: now,
          expiresAt: now + TOOL_HANDOFF_TTL_MS,
        };

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
