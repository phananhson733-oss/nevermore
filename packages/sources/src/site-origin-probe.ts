import { fetch as undiciFetch } from "undici";
import { createPinnedAgent } from "./url-safety/pin-agent.ts";

const DEFAULT_SITE_ORIGIN_PROBE_TIMEOUT_MS = 5_000;

export interface SiteOriginProbeInput {
  readonly origin: string;
  readonly pinnedIp: string;
}

export type SiteOriginProbe = (
  input: SiteOriginProbeInput,
) => Promise<boolean>;

export type SiteOriginProbeFetch = (
  url: string,
  init: {
    readonly method: "GET";
    readonly redirect: "manual";
    readonly signal: AbortSignal;
    readonly dispatcher: unknown;
    readonly headers: Readonly<Record<string, string>>;
  },
) => Promise<Response>;

export interface SiteOriginProbeOptions {
  readonly fetch?: SiteOriginProbeFetch;
  readonly timeoutMs?: number;
}

/**
 * Perform one DNS-pinned, redirect-free reachability request before a submitted
 * HTTP origin is upgraded to HTTPS (spec §6.1). Any HTTP response proves that
 * the origin is reachable; status/body content is deliberately ignored and
 * never logged. The Range header minimizes bytes when the server supports it.
 */
export function createSiteOriginProbe(
  options: SiteOriginProbeOptions = {},
): SiteOriginProbe {
  const fetchImpl = options.fetch ?? (undiciFetch as unknown as SiteOriginProbeFetch);
  const timeoutMs = options.timeoutMs ?? DEFAULT_SITE_ORIGIN_PROBE_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError("site origin probe timeout must be positive");
  }

  return async ({ origin, pinnedIp }): Promise<boolean> => {
    let target: URL;
    try {
      target = new URL(origin);
    } catch {
      return false;
    }
    if (
      target.protocol !== "https:" ||
      target.username !== "" ||
      target.password !== "" ||
      target.pathname !== "/" ||
      target.search !== "" ||
      target.hash !== ""
    ) {
      return false;
    }

    let dispatcher: ReturnType<typeof createPinnedAgent>;
    try {
      dispatcher = createPinnedAgent(target.hostname, pinnedIp);
    } catch {
      return false;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(target.origin, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        dispatcher,
        headers: {
          Accept: "text/html,*/*;q=0.1",
          Range: "bytes=0-0",
          "User-Agent": "SignalFrame-Origin-Probe/0.2",
        },
      });
      try {
        await response.body?.cancel();
      } catch {
        // Reachability is already proven; body cancellation failure is ignored.
      }
      return true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
      try {
        await dispatcher.close();
      } catch {
        // The operation result must not expose or depend on transport cleanup.
      }
    }
  };
}

export const probeSiteOrigin = createSiteOriginProbe();
