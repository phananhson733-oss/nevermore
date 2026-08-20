// @input  -- one provider hostname plus the official IANA DNS RDAP bootstrap
// @output -- bounded registration-date evidence with explicit unavailability
// @pos    -- credential-free RDAP source boundary; projects no owner/contact data
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import { getDomain } from "tldts";
import {
  cancelResponseBody,
  createRequestAbortScope,
  readBoundedJson,
} from "../provider-http.ts";

/** Official IANA bootstrap registry for the DNS RDAP namespace. */
export const IANA_RDAP_DNS_BOOTSTRAP_URL =
  "https://data.iana.org/rdap/dns.json";

export const DEFAULT_RDAP_REQUEST_TIMEOUT_MS = 10_000;
export const DEFAULT_RDAP_MAX_RESPONSE_BYTES = 1_048_576;

export type DomainRegistrationUnavailableReason =
  | "invalid_domain"
  | "unsupported_tld"
  | "bootstrap_unavailable"
  | "bootstrap_malformed"
  | "domain_not_found"
  | "registry_unavailable"
  | "registration_event_missing"
  | "reregistration_only"
  | "last_changed_only"
  | "registration_date_malformed";

export interface DomainRegistrationEvidence {
  /** ASCII registrable domain, or null before an authoritative lookup exists. */
  readonly domain: string | null;
  readonly availability: "available" | "unavailable";
  readonly registeredAt: string | null;
  readonly observedAt: string;
  /** RDAP registry host that supplied the domain object, never registrar data. */
  readonly sourceHost: string | null;
  readonly reason: DomainRegistrationUnavailableReason | null;
}

export interface DomainRegistrationResolver {
  resolve(
    domain: string,
    signal?: AbortSignal,
  ): Promise<DomainRegistrationEvidence>;
}

export interface DomainRegistrationResolverOptions {
  /** Fully injected in unit tests; defaults to the platform fetch. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
  readonly signal?: AbortSignal;
  readonly now?: () => Date;
}

interface NormalizedDomain {
  readonly domain: string;
  readonly tld: string;
}

interface RegistryServer {
  readonly baseUrl: URL;
  readonly sourceHost: string;
}

type JsonRecord = Record<string, unknown>;

type BootstrapLoad =
  | { readonly availability: "available"; readonly payload: unknown }
  | { readonly availability: "unavailable" };

type JsonRead =
  | { readonly kind: "available"; readonly payload: unknown }
  | { readonly kind: "not_found" }
  | { readonly kind: "unavailable" };

function waitForSharedBootstrap(
  pending: Promise<BootstrapLoad>,
  signal?: AbortSignal,
): Promise<BootstrapLoad | null> {
  if (signal === undefined) return pending;
  if (signal.aborted) return Promise.resolve(null);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: BootstrapLoad | null): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      resolve(value);
    };
    const onAbort = (): void => finish(null);
    signal.addEventListener("abort", onAbort, { once: true });
    void pending.then(
      (loaded) => finish(loaded),
      () => finish({ availability: "unavailable" }),
    );
  });
}

function asRecord(value: unknown): JsonRecord | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;
}

function observedAt(options: DomainRegistrationResolverOptions): string {
  const value = options.now?.() ?? new Date();
  if (!Number.isFinite(value.getTime())) {
    throw new TypeError("RDAP observation clock returned an invalid date.");
  }
  return value.toISOString();
}

function unavailable(
  at: string,
  reason: DomainRegistrationUnavailableReason,
  domain: string | null = null,
  sourceHost: string | null = null,
): DomainRegistrationEvidence {
  return {
    domain,
    availability: "unavailable",
    registeredAt: null,
    observedAt: at,
    sourceHost,
    reason,
  };
}

/** ICANN registrable domain used for authoritative registry lookup. */
export function normalizeRdapDomain(value: string): string | null {
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
  const domain = getDomain(ascii, { allowPrivateDomains: false });
  return domain === null ? null : domain.toLowerCase();
}

function normalizeDomain(value: string): NormalizedDomain | null {
  const domain = normalizeRdapDomain(value);
  const tld = domain?.split(".").at(-1);
  return domain === null || tld === undefined ? null : { domain, tld };
}

function validRegistryServer(value: unknown): RegistryServer | null {
  if (typeof value !== "string") return null;
  try {
    const parsed = new URL(value);
    const hostname = domainToASCII(parsed.hostname.toLowerCase());
    if (
      parsed.protocol !== "https:" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.port !== "" ||
      parsed.search !== "" ||
      parsed.hash !== "" ||
      hostname === "" ||
      isIP(hostname) !== 0 ||
      getDomain(hostname, { allowPrivateDomains: false }) === null
    ) {
      return null;
    }
    parsed.hostname = hostname;
    if (!parsed.pathname.endsWith("/")) parsed.pathname += "/";
    return { baseUrl: parsed, sourceHost: hostname };
  } catch {
    return null;
  }
}

function registryForTld(
  payload: unknown,
  tld: string,
): RegistryServer | "unsupported" | "malformed" {
  const root = asRecord(payload);
  const services = root?.["services"];
  if (!Array.isArray(services)) return "malformed";

  for (const rawService of services) {
    if (!Array.isArray(rawService) || rawService.length < 2) continue;
    const suffixes = rawService[0];
    const servers = rawService[1];
    if (!Array.isArray(suffixes) || !Array.isArray(servers)) continue;
    const matches = suffixes.some(
      (suffix) =>
        typeof suffix === "string" && suffix.trim().toLowerCase() === tld,
    );
    if (!matches) continue;
    for (const server of servers) {
      const validated = validRegistryServer(server);
      if (validated !== null) return validated;
    }
    return "malformed";
  }
  return "unsupported";
}

function strictEventDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/u.exec(
      value,
    );
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[7] === "Z" ? 0 : Number(match[8]);
  const offsetMinute = match[7] === "Z" ? 0 : Number(match[9]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const monthDays = [
    31,
    leapYear ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ];
  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > (monthDays[month - 1] ?? 0) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59 ||
    offsetHour < 0 ||
    offsetHour > 23 ||
    offsetMinute < 0 ||
    offsetMinute > 59
  ) {
    return null;
  }
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function parseRegistration(
  payload: unknown,
  domain: string,
  sourceHost: string,
  at: string,
): DomainRegistrationEvidence {
  const root = asRecord(payload);
  if (root === null) {
    return unavailable(at, "registry_unavailable", domain, sourceHost);
  }
  const rawEvents = root["events"];
  if (rawEvents !== undefined && !Array.isArray(rawEvents)) {
    return unavailable(at, "registry_unavailable", domain, sourceHost);
  }
  const events = (Array.isArray(rawEvents) ? rawEvents : [])
    .map(asRecord)
    .filter((event): event is JsonRecord => event !== null);
  const registrations = events.filter(
    (event) => event["eventAction"] === "registration",
  );
  const validDates = registrations
    .map((event) => strictEventDate(event["eventDate"]))
    .filter((value): value is string => value !== null)
    .sort();
  const registeredAt = validDates[0];
  if (registeredAt !== undefined) {
    return {
      domain,
      availability: "available",
      registeredAt,
      observedAt: at,
      sourceHost,
      reason: null,
    };
  }
  if (registrations.length > 0) {
    return unavailable(at, "registration_date_malformed", domain, sourceHost);
  }

  const actions = new Set(events.map((event) => event["eventAction"]));
  if (actions.has("reregistration") && !actions.has("last changed")) {
    return unavailable(at, "reregistration_only", domain, sourceHost);
  }
  if (actions.has("last changed") && !actions.has("reregistration")) {
    return unavailable(at, "last_changed_only", domain, sourceHost);
  }
  return unavailable(at, "registration_event_missing", domain, sourceHost);
}

/**
 * Create a request-scoped resolver.
 *
 * The IANA bootstrap is fetched lazily once per resolver. Domain results are
 * intentionally not cached here; callers can add request-local or durable
 * caches without changing this source contract.
 */
export function createDomainRegistrationResolver(
  options: DomainRegistrationResolverOptions = {},
): DomainRegistrationResolver {
  const fetchImpl = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_RDAP_REQUEST_TIMEOUT_MS;
  const maxResponseBytes =
    options.maxResponseBytes ?? DEFAULT_RDAP_MAX_RESPONSE_BYTES;
  let bootstrapPromise: Promise<BootstrapLoad> | null = null;

  const readJson = async (
    url: string,
    context: string,
    signal?: AbortSignal,
  ): Promise<JsonRead> => {
    const abortScope = createRequestAbortScope(timeoutMs, [
      options.signal,
      signal,
    ]);
    try {
      const response = await fetchImpl(url, {
        method: "GET",
        redirect: "error",
        signal: abortScope.signal,
        headers: { Accept: "application/rdap+json, application/json" },
      });
      if (!response.ok) {
        await cancelResponseBody(response);
        return {
          kind: response.status === 404 ? "not_found" : "unavailable",
        };
      }
      return {
        kind: "available",
        payload: await readBoundedJson(
          response,
          maxResponseBytes,
          context,
          abortScope.signal,
        ),
      };
    } catch {
      return { kind: "unavailable" };
    } finally {
      abortScope.cleanup();
    }
  };

  const loadBootstrap = (): Promise<BootstrapLoad> => {
    if (bootstrapPromise !== null) return bootstrapPromise;
    const pending = readJson(
      IANA_RDAP_DNS_BOOTSTRAP_URL,
      "IANA RDAP DNS bootstrap",
    ).then((read) => {
      const loaded: BootstrapLoad =
        read.kind === "available"
          ? { availability: "available", payload: read.payload }
          : { availability: "unavailable" };
      if (
        loaded.availability === "unavailable" &&
        bootstrapPromise === pending
      ) {
        bootstrapPromise = null;
      }
      return loaded;
    });
    bootstrapPromise = pending;
    return pending;
  };

  return {
    async resolve(input, signal) {
      const at = observedAt(options);
      const normalized = normalizeDomain(input);
      if (normalized === null) return unavailable(at, "invalid_domain");
      if (signal?.aborted) {
        return unavailable(at, "registry_unavailable", normalized.domain);
      }

      const loaded = await waitForSharedBootstrap(loadBootstrap(), signal);
      if (loaded === null || signal?.aborted) {
        return unavailable(at, "registry_unavailable", normalized.domain);
      }
      if (loaded.availability === "unavailable") {
        return unavailable(at, "bootstrap_unavailable");
      }
      const registry = registryForTld(loaded.payload, normalized.tld);
      if (registry === "unsupported") {
        return unavailable(at, "unsupported_tld");
      }
      if (registry === "malformed") {
        bootstrapPromise = null;
        return unavailable(at, "bootstrap_malformed");
      }

      const requestUrl = new URL(
        `domain/${encodeURIComponent(normalized.domain)}`,
        registry.baseUrl,
      );
      const read = await readJson(
        requestUrl.href,
        `RDAP domain response from ${registry.sourceHost}`,
        signal,
      );
      if (read.kind === "not_found") {
        return unavailable(
          at,
          "domain_not_found",
          normalized.domain,
          registry.sourceHost,
        );
      }
      if (read.kind === "unavailable") {
        return unavailable(
          at,
          "registry_unavailable",
          normalized.domain,
          registry.sourceHost,
        );
      }
      return parseRegistration(
        read.payload,
        normalized.domain,
        registry.sourceHost,
        at,
      );
    },
  };
}
