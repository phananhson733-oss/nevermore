// @input  -- sessionStorage-like access, the current time, and one private tool handoff
// @output -- a one-time, tab-scoped handoff between connected tools without URL leakage
// @pos    -- the only browser storage used for private connected-tool navigation

export const TOOL_HANDOFF_KEY = "gengrowth.tool-handoff.v1";
export const TOOL_HANDOFF_TTL_MS = 10 * 60 * 1_000;

/**
 * How a link that carries a handoff must open, for every surface that sends one.
 *
 * A new tab, because the reports these leave are not recoverable: manual
 * snapshots with `persistence: "none"`, no server copy and no URL state, and
 * the briefing additionally spends one of the property's hourly Search Console
 * slots per run. Following an action in the same tab threw that away and left
 * Back pointing at an empty form.
 *
 * `rel="opener"` is load-bearing and must not be "corrected" to `noopener`.
 * The handoff rides session storage, a new tab receives a copy of it only when
 * it keeps an opener, and current browsers apply noopener to `target="_blank"`
 * by default -- measured in Chromium and WebKit, a `noopener` destination
 * reads `null` and looks like it lost the property this page just handed it.
 *
 * What that costs, stated accurately: same-origin is a permission, not a
 * reference, so keeping an opener really does hand the destination a Window it
 * would not otherwise have. The bound is the destination set -- fixed `/tools/`
 * literals on our own origin, with `locale` whitelisted against
 * `routing.locales` in the locale layout before any of this renders.
 *
 * Spread onto the anchor rather than restated at each call site: the briefing
 * had six copies of this pair, and nothing but a test sweep stopping a seventh
 * link from being added without them. Cross-origin links do NOT use this --
 * they carry no handoff and keep `noopener noreferrer`.
 */
export const TOOL_HANDOFF_LINK_PROPS = {
  target: "_blank",
  rel: "opener",
} as const;

export type ToolHandoffDestination =
  | "seo-quick-wins"
  | "traffic-drop-diagnosis"
  | "on-page-seo-check"
  | "page-citability-check";

type SearchHandoffDestination = Exclude<ToolHandoffDestination, "page-citability-check">;

export interface ToolHandoffStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

export type ToolHandoffPayload =
  | {
      readonly source: "daily-search-briefing";
      readonly destination: SearchHandoffDestination;
      readonly scope: "query_page";
      readonly property: string;
      readonly query: string;
      readonly page: string;
      readonly evidenceId: string;
    }
  | {
      readonly source: "daily-search-briefing";
      readonly destination: Exclude<
        SearchHandoffDestination,
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
      readonly destination: Exclude<SearchHandoffDestination, "seo-quick-wins">;
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
    }
  /**
   * A draft the visitor just published, handed to the checker with the
   * keyword it was written for.
   *
   * `property` is null on purpose. The Content Draft Writer never reads Search
   * Console, so there is no property this page was observed under, and the
   * page is the visitor's own freshly published URL rather than one a property
   * returned — which is why it is checked as a safe URL only and not bound to
   * a property the way the briefing's pages are. `evidenceId` is the brief's
   * fingerprint (sha256 hex), so a report can be traced to the exact brief.
   */
  | {
      readonly source: "content-draft";
      readonly destination: "on-page-seo-check" | "page-citability-check";
      readonly scope: "query_page";
      readonly property: null;
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

/**
 * The handoff variants a destination can actually receive.
 *
 * `consumeToolHandoff` already refuses a stored handoff addressed elsewhere,
 * so the property tools never see a `content-draft` handoff at runtime; this
 * says so to the type checker, which otherwise widens `property` to
 * `string | null` in every consumer the moment one source carries no property.
 * A variant whose `destination` is itself a union is kept for each member.
 */
export type ToolHandoffFor<D extends ToolHandoffDestination> =
  NarrowByDestination<ToolHandoff, D>;

type NarrowByDestination<H, D> = H extends {
  readonly destination: infer HD;
}
  ? D extends HD
    ? H
    : never
  : never;

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
// Spelled out rather than aliased to the gap set: the two shapes coincide
// today, and a field added to one must not silently become required by the
// other.
const CONTENT_DRAFT_PAYLOAD_KEYS: ReadonlySet<string> = new Set([
  "source",
  "destination",
  "scope",
  "property",
  "query",
  "page",
  "evidenceId",
  "marketCode",
  "languageCode",
]);
const CONTENT_DRAFT_HANDOFF_KEYS: ReadonlySet<string> = new Set([
  ...CONTENT_DRAFT_PAYLOAD_KEYS,
  "createdAt",
  "expiresAt",
]);
const MARKET_CODE = /^[A-Z]{2}$/u;
const LANGUAGE_CODE = /^[a-z]{2}$/u;
/**
 * A brief fingerprint: `sha256Hex` in `@sf/public-tools/content-brief`
 * emits lowercase hex on both its digest paths, so uppercase is a forgery,
 * not an alternate spelling.
 */
const BRIEF_FINGERPRINT = /^[0-9a-f]{64}$/u;

function isDestination(value: unknown): value is SearchHandoffDestination {
  return (
    value === "seo-quick-wins" ||
    value === "traffic-drop-diagnosis" ||
    value === "on-page-seo-check"
  );
}

function isPageDestination(
  value: unknown,
): value is Exclude<SearchHandoffDestination, "seo-quick-wins"> {
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
/**
 * Decode only the escapes that carry no meaning.
 *
 * `decodeURI` over the whole path is not injective: it turns `/%252F/` into
 * `/%2F/`, so a property and a page whose serialized paths differ start
 * comparing equal. RFC 3986 says a percent-encoded unreserved octet is
 * equivalent to the character itself and nothing else is, so only those are
 * folded.
 */
const UNRESERVED_ESCAPE = /%(?:2[DdEe]|3[0-9]|4[1-9A-Fa-f]|5[0-9Aa]|5[Ff]|6[1-9A-Fa-f]|7[0-9Aa]|7[Ee])/g;

function canonicalPath(pathname: string): string {
  return pathname.replace(UNRESERVED_ESCAPE, (escape) => {
    const char = String.fromCharCode(Number.parseInt(escape.slice(1), 16));
    return /[A-Za-z0-9\-._~]/.test(char) ? char : escape;
  });
}

/** A Search Console domain property is a bare host and nothing else. */
const BARE_HOSTNAME = /^[a-z0-9\u00a1-\uffff](?:[a-z0-9\-._\u00a1-\uffff]*[a-z0-9\u00a1-\uffff])?$/iu;

function withoutRootDot(host: string): string {
  const lower = host.toLowerCase();
  return lower.endsWith(".") ? lower.slice(0, -1) : lower;
}

/** Whether the string is a Search Console property identifier at all. */
function isProperty(property: string): boolean {
  const trimmed = property.trim();
  if (trimmed.startsWith("sc-domain:")) {
    return BARE_HOSTNAME.test(trimmed.slice("sc-domain:".length).trim());
  }
  try {
    const url = new URL(trimmed);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.hostname !== "" &&
      url.username === "" &&
      url.password === "" &&
      url.search === "" &&
      url.hash === ""
    );
  } catch {
    return false;
  }
}

function pageBelongsToProperty(property: string, page: unknown): boolean {
  if (!isProperty(property)) return false;
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
      // A bare host, checked before it is handed to `URL`. Otherwise
      // `sc-domain:user:pw@example.com`, `sc-domain:example.com/path` and
      // `sc-domain:example.com?x=1` all reduce to the hostname buried in them
      // and are accepted as the property they merely contain.
      if (!BARE_HOSTNAME.test(raw)) return false;
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
    const prefixPath = canonicalPath(prefix.pathname);
    const pagePath = canonicalPath(url.pathname);
    const base = prefixPath.endsWith("/") ? prefixPath : `${prefixPath}/`;
    return pagePath === prefixPath || pagePath.startsWith(base);
  } catch {
    return false;
  }
}

function isPropertyDestination(
  value: unknown,
): value is Exclude<SearchHandoffDestination, "on-page-seo-check"> {
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
  if (value.source === "content-draft") {
    return CONTENT_DRAFT_PAYLOAD_KEYS;
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
  if (value.source === "content-draft") {
    return CONTENT_DRAFT_HANDOFF_KEYS;
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
 * A gap keyword's numbers, and a brief's SERP read, only mean anything inside
 * the market they were read in, so every destination of those sources carries
 * it. Checked apart from the target below so that adding a destination cannot
 * quietly ship a handoff without a market.
 */
function hasValidMarketContext(
  value: Readonly<Record<string, unknown>>,
): boolean {
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

/**
 * The draft writer hands the checker the page it just helped publish, so the
 * page is checked as a URL the checker can fetch and nothing more: there is no
 * property to bind it to, and `property` must say so with an explicit null
 * rather than an empty string that a reader could mistake for a blank
 * identifier. The evidence is the brief fingerprint, pinned to its exact shape
 * so an arbitrary label cannot pose as one.
 */
function hasValidContentDraftFields(
  value: Readonly<Record<string, unknown>>,
): boolean {
  return (
    (value.destination === "on-page-seo-check" || value.destination === "page-citability-check") &&
    value.scope === "query_page" &&
    value.property === null &&
    typeof value.evidenceId === "string" &&
    BRIEF_FINGERPRINT.test(value.evidenceId) &&
    nonEmptyString(value.query, MAX_QUERY_LENGTH) &&
    isSafeHttpPage(value.page) &&
    hasValidMarketContext(value)
  );
}

function hasValidPayloadFields(
  value: Readonly<Record<string, unknown>>,
): boolean {
  // Branched before the shared property check: this is the one source with
  // no property, and its evidence is a fingerprint rather than a free label.
  if (value.source === "content-draft") {
    return hasValidContentDraftFields(value);
  }

  if (
    !nonEmptyString(value.property, MAX_PROPERTY_LENGTH) ||
    !nonEmptyString(value.evidenceId, MAX_EVIDENCE_ID_LENGTH)
  ) {
    return false;
  }

  if (value.source === "competitor-keyword-gap") {
    return hasValidMarketContext(value) && hasValidGapTarget(value);
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
      // The property identifier is checked here too. Every other daily
      // briefing scope proves the property parses before it uses it, and a
      // scope that carries the property alone should not be the one that
      // skips the check.
      return (
        isPropertyDestination(value.destination) &&
        value.query === null &&
        value.page === null &&
        typeof value.property === "string" &&
        isProperty(value.property)
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

/**
 * Its own builder for the same reason the gap one is: the stored shape is
 * exactly what this source sends, and `property` stays the literal null the
 * validator demanded rather than a trimmed string. The fingerprint is stored
 * untrimmed because the validator accepted only its exact 64 characters.
 */
function toContentDraftHandoff(
  payload: Extract<ToolHandoffPayload, { source: "content-draft" }>,
  now: number,
): ToolHandoff {
  return {
    source: payload.source,
    destination: payload.destination,
    scope: payload.scope,
    property: null,
    query: payload.query.trim(),
    page: payload.page.trim(),
    evidenceId: payload.evidenceId,
    marketCode: payload.marketCode,
    languageCode: payload.languageCode,
    createdAt: now,
    expiresAt: now + TOOL_HANDOFF_TTL_MS,
  };
}

function toHandoff(payload: ToolHandoffPayload, now: number): ToolHandoff {
  if (payload.source === "competitor-keyword-gap") {
    return toGapHandoff(payload, now);
  }
  if (payload.source === "content-draft") {
    return toContentDraftHandoff(payload, now);
  }
  return toBriefingHandoff(payload, now);
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

  // Three scopes, and `page` is not a degenerate `query_page`: the page
  // dimension names a page with no query behind it, because Search Console
  // anonymizes the queries that moved it. Filling `query` with an empty
  // string to reuse one branch would hand the next tool a query the briefing
  // never saw.
  if (payload.scope === "query_page") {
    return {
      ...shared,
      destination: payload.destination,
      scope: payload.scope,
      query: payload.query.trim(),
      page: payload.page.trim(),
    };
  }
  if (payload.scope === "page") {
    return {
      ...shared,
      destination: payload.destination,
      scope: payload.scope,
      query: null,
      page: payload.page.trim(),
    };
  }
  return {
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

  const handoff = toHandoff(payload, now);

  try {
    storage.setItem(TOOL_HANDOFF_KEY, JSON.stringify(handoff));
    return true;
  } catch {
    return false;
  }
}

export function consumeToolHandoff<D extends ToolHandoffDestination>(
  storage: ToolHandoffStorage,
  now: number,
  destination: D,
): ToolHandoffFor<D> | null {
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
    // The equality above is the narrowing `ToolHandoffFor` describes; the
    // checker cannot follow a comparison against a generic parameter, so the
    // relation it just verified at runtime is restated here.
    return parsed as ToolHandoffFor<D>;
  } catch {
    return null;
  }
}
