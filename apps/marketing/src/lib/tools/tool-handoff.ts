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

export interface ToolHandoffPayload {
  readonly source: "daily-search-briefing";
  readonly destination: ToolHandoffDestination;
  readonly property: string;
  readonly query: string;
  readonly page: string;
  readonly evidenceId: string;
}

export interface ToolHandoff extends ToolHandoffPayload {
  readonly createdAt: number;
  readonly expiresAt: number;
}

const MAX_PROPERTY_LENGTH = 512;
const MAX_QUERY_LENGTH = 512;
const MAX_PAGE_LENGTH = 2_048;
const MAX_EVIDENCE_ID_LENGTH = 256;
const PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  "source",
  "destination",
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

function isToolHandoff(value: unknown): value is ToolHandoff {
  if (!isObject(value) || !hasExactKeys(value, HANDOFF_KEYS)) return false;
  const candidate = value as Partial<ToolHandoff>;
  return (
    candidate.source === "daily-search-briefing" &&
    isDestination(candidate.destination) &&
    nonEmptyString(candidate.property, MAX_PROPERTY_LENGTH) &&
    nonEmptyString(candidate.query, MAX_QUERY_LENGTH) &&
    nonEmptyString(candidate.page, MAX_PAGE_LENGTH) &&
    nonEmptyString(candidate.evidenceId, MAX_EVIDENCE_ID_LENGTH) &&
    isFiniteTimestamp(candidate.createdAt) &&
    isFiniteTimestamp(candidate.expiresAt) &&
    candidate.expiresAt > candidate.createdAt &&
    candidate.expiresAt - candidate.createdAt <= TOOL_HANDOFF_TTL_MS
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
    payload.source !== "daily-search-briefing" ||
    !isDestination(payload.destination) ||
    !nonEmptyString(payload.property, MAX_PROPERTY_LENGTH) ||
    !nonEmptyString(payload.query, MAX_QUERY_LENGTH) ||
    !nonEmptyString(payload.page, MAX_PAGE_LENGTH) ||
    !nonEmptyString(payload.evidenceId, MAX_EVIDENCE_ID_LENGTH)
  ) {
    return false;
  }

  const handoff: ToolHandoff = {
    source: payload.source,
    destination: payload.destination,
    property: payload.property.trim(),
    query: payload.query.trim(),
    page: payload.page.trim(),
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
