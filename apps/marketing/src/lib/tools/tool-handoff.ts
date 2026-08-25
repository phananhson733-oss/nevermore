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
      /**
       * A page with no query behind it.
       *
       * The page-dimension lanes name a page and nothing else — Search Console
       * anonymizes the queries that made it move — so neither `query_page` nor
       * `property` fits. Filling `query` with an empty string to reuse
       * `query_page` would hand the next tool a query the briefing never saw.
       */
      readonly source: "daily-search-briefing";
      /**
       * Only the two the page lanes can produce. `seo-quick-wins` ranks query
       * opportunities and has nothing to do with a page carrying no query, so
       * accepting it here would admit a handoff no lane can generate.
       */
      readonly destination: Exclude<ToolHandoffDestination, "seo-quick-wins">;
      readonly scope: "page";
      readonly property: string;
      readonly query: null;
      readonly page: string;
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

function isPageDestination(
  value: unknown,
): value is Exclude<ToolHandoffDestination, "seo-quick-wins"> {
  return value === "traffic-drop-diagnosis" || value === "on-page-seo-check";
}

/**
 * Whether the page is inside the property the handoff claims to describe.
 *
 * A syntactically safe URL from another site would attach a Daily Briefing
 * measurement to a page the briefing never read. Search Console will not
 * return such a pair, so refusing it costs nothing and closes the gap between
 * "this is a URL" and "this is a URL this property could have produced".
 */
function decodedPath(pathname: string): string {
  try {
    return decodeURI(pathname);
  } catch {
    return pathname;
  }
}

function withoutRootDot(host: string): string {
  const lower = host.toLowerCase();
  return lower.endsWith(".") ? lower.slice(0, -1) : lower;
}

function pageBelongsToProperty(property: string, page: unknown): boolean {
  if (!isSafeHttpPage(page)) return false;
  try {
    const url = new URL(page.trim());
    // Compared as hostnames, not as strings. `URL` lowercases and punycodes
    // in one step, so an IDN property written in Unicode still matches the
    // page Search Console returns in its ASCII form; a trailing dot on either
    // side names the same host and must not decide the answer.
    const host = withoutRootDot(url.hostname);
    if (property.startsWith("sc-domain:")) {
      const raw = property.slice("sc-domain:".length).trim();
      if (raw === "") return false;
      const domain = withoutRootDot(new URL(`https://${raw}`).hostname);
      if (domain === "") return false;
      return host === domain || host.endsWith(`.${domain}`);
    }
    const prefix = new URL(property.trim());
    // A property identifier is a prefix, not a request: credentials, a query
    // or a fragment mean the string is not one, and matching only its host and
    // path would let `https://user:pw@example.com/about?x=1#f` stand in for
    // the property it merely resembles.
    if (
      prefix.username !== "" ||
      prefix.password !== "" ||
      prefix.search !== "" ||
      prefix.hash !== ""
    ) {
      return false;
    }
    if (
      prefix.protocol !== url.protocol ||
      withoutRootDot(prefix.hostname) !== host ||
      prefix.port !== url.port
    ) {
      return false;
    }
    // On a segment boundary, not a character one. A bare `startsWith` accepts
    // `/aboutus` for a property scoped to `/about`, which is a different
    // section of the site.
    // Compared after decoding the escapes that carry no meaning, so `/%7Eteam`
    // and `/~team` are the one path they name. Decoding can throw on a
    // malformed escape; the raw forms are then compared instead.
    const prefixPath = decodedPath(prefix.pathname);
    const pagePath = decodedPath(url.pathname);
    const base = prefixPath.endsWith("/") ? prefixPath : `${prefixPath}/`;
    return pagePath === prefixPath || pagePath.startsWith(base);
  } catch {
    return false;
  }
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
    return (
      value.destination === "on-page-seo-check" &&
      value.scope === "query_page" &&
      nonEmptyString(value.query, MAX_QUERY_LENGTH) &&
      isSafeHttpPage(value.page) &&
      typeof value.marketCode === "string" &&
      MARKET_CODE.test(value.marketCode) &&
      typeof value.languageCode === "string" &&
      LANGUAGE_CODE.test(value.languageCode)
    );
  }

  if (value.source === "daily-search-briefing") {
    if (value.scope === "query_page") {
      // Bound to the property for the same reason the page scope is: a
      // syntactically safe URL from another site would attach Search Console
      // evidence to a page this property never returned. Applied only to the
      // daily-briefing source — a competitor gap handoff carries a competitor's
      // page on purpose, and binding that one would break it.
      return (
        isDestination(value.destination) &&
        nonEmptyString(value.query, MAX_QUERY_LENGTH) &&
        typeof value.property === "string" &&
        pageBelongsToProperty(value.property, value.page)
      );
    }

    if (value.scope === "page") {
      // The page is the entire payload here, and the destination will fetch
      // it, so it is checked as a URL, as a URL this property could have
      // produced, and against the two destinations a page lane can name.
      return (
        isPageDestination(value.destination) &&
        value.query === null &&
        typeof value.property === "string" &&
        pageBelongsToProperty(value.property, value.page)
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
      ? {
          source: payload.source,
          destination: payload.destination,
          scope: payload.scope,
          property: payload.property.trim(),
          query: payload.query.trim(),
          page: payload.page.trim(),
          evidenceId: payload.evidenceId.trim(),
          marketCode: payload.marketCode,
          languageCode: payload.languageCode,
          createdAt: now,
          expiresAt: now + TOOL_HANDOFF_TTL_MS,
        }
      : payload.scope === "query_page"
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
        : payload.scope === "page"
        ? {
            source: payload.source,
            destination: payload.destination,
            scope: payload.scope,
            property: payload.property.trim(),
            query: null,
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
