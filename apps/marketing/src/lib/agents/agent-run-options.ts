// @input  -- Agent identity, Profile target URL, and client-entered run controls
// @output -- client-safe crawl-tier defaults and bounded manual-page snapshots
// @pos    -- pure run-options contract shared by the Agent UI, intent guard, and request parser

export const AGENT_RUN_EXTRA_KEY_PAGE_LIMIT = 10;
export const AGENT_RUN_URL_MAX_CHARS = 2_048;

type AgentRunKind = "seo" | "tech";

export type AgentRunTier = "key-pages" | "full-site";

export interface AgentRunOptions {
  readonly tier: AgentRunTier;
  readonly extraKeyPages: readonly string[];
}

export type AgentRunOptionsError = "too_many" | "invalid" | "cross_origin";

export type ParsedAgentExtraKeyPages =
  | { readonly ok: true; readonly extraKeyPages: readonly string[] }
  | { readonly ok: false; readonly error: AgentRunOptionsError };

export function defaultAgentRunOptions(agent: AgentRunKind): AgentRunOptions {
  return agent === "seo"
    ? { tier: "key-pages", extraKeyPages: [] }
    : { tier: "full-site", extraKeyPages: [] };
}

/** Canonicalize the Profile target for client-side identity and safe handoff use. */
export function normalizeAgentRunTargetUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > AGENT_RUN_URL_MAX_CHARS) return null;
  try {
    const candidate =
      /^[A-Za-z][A-Za-z\d+.-]*:\/\//.test(trimmed)
        ? trimmed
        : `https://${trimmed}`;
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      /^[A-Za-z][A-Za-z\d+.-]*:\/\/[^/?#]*@/.test(candidate)
    ) {
      return null;
    }
    parsed.hash = "";
    return parsed.href;
  } catch {
    return null;
  }
}

function parseManualUrl(value: string): URL | null {
  if (
    !value ||
    value.length > AGENT_RUN_URL_MAX_CHARS ||
    value.includes("#") ||
    /^[A-Za-z][A-Za-z\d+.-]*:\/\/[^/?#]*@/.test(value)
  ) {
    return null;
  }
  try {
    const parsed = new URL(value);
    if (
      (parsed.protocol !== "http:" && parsed.protocol !== "https:") ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.hash !== ""
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function withoutWww(hostname: string): string {
  return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
}

/** Match the crawl entry policy: exact host or one apex/www transition, never HTTPS down. */
export function isAllowedAgentRunSiteUrl(
  targetUrl: string,
  candidateUrl: string,
): boolean {
  let target: URL;
  let candidate: URL;
  try {
    target = new URL(targetUrl);
    candidate = new URL(candidateUrl);
  } catch {
    return false;
  }
  if (
    (target.protocol !== "http:" && target.protocol !== "https:") ||
    (candidate.protocol !== "http:" && candidate.protocol !== "https:") ||
    target.username !== "" ||
    target.password !== "" ||
    candidate.username !== "" ||
    candidate.password !== "" ||
    (target.protocol === "https:" && candidate.protocol !== "https:")
  ) {
    return false;
  }

  const targetHost = target.hostname.toLowerCase();
  const candidateHost = candidate.hostname.toLowerCase();
  if (withoutWww(targetHost) !== withoutWww(candidateHost)) return false;
  return (
    targetHost === candidateHost ||
    targetHost === `www.${candidateHost}` ||
    candidateHost === `www.${targetHost}`
  );
}

export function parseAgentExtraKeyPages(
  targetUrl: string,
  raw: string,
): ParsedAgentExtraKeyPages {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => ({ raw: line, value: line.trim() }))
    .filter(({ value }) => value !== "");
  if (lines.length > AGENT_RUN_EXTRA_KEY_PAGE_LIMIT) {
    return { ok: false, error: "too_many" };
  }
  if (lines.length === 0) return { ok: true, extraKeyPages: [] };

  const normalizedTarget = normalizeAgentRunTargetUrl(targetUrl);
  if (!normalizedTarget) return { ok: false, error: "invalid" };
  const target = new URL(normalizedTarget);

  const pages = new Set<string>();
  for (const line of lines) {
    if (line.raw.length > AGENT_RUN_URL_MAX_CHARS) {
      return { ok: false, error: "invalid" };
    }
    const parsed = parseManualUrl(line.value);
    if (!parsed) return { ok: false, error: "invalid" };
    if (!isAllowedAgentRunSiteUrl(target.href, parsed.href)) {
      return { ok: false, error: "cross_origin" };
    }
    const rebased = new URL(`${parsed.pathname}${parsed.search}`, target.origin);
    if (rebased.href !== target.href) pages.add(rebased.href);
  }

  return {
    ok: true,
    extraKeyPages: [...pages].sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  };
}

export function normalizeStoredAgentRunOptions(
  agent: AgentRunKind,
  targetUrl: string,
  value: unknown,
): AgentRunOptions | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as {
    readonly tier?: unknown;
    readonly extraKeyPages?: unknown;
  };
  if (
    Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, "tier") ||
    !Object.hasOwn(value, "extraKeyPages") ||
    (candidate.tier !== "key-pages" && candidate.tier !== "full-site") ||
    !Array.isArray(candidate.extraKeyPages) ||
    !candidate.extraKeyPages.every((entry) => typeof entry === "string")
  ) {
    return null;
  }
  if (
    agent === "tech" &&
    (candidate.tier !== "full-site" || candidate.extraKeyPages.length !== 0)
  ) {
    return null;
  }

  const parsed = parseAgentExtraKeyPages(
    targetUrl,
    candidate.extraKeyPages.join("\n"),
  );
  if (!parsed.ok || parsed.extraKeyPages.length !== candidate.extraKeyPages.length) {
    return null;
  }
  return { tier: candidate.tier, extraKeyPages: parsed.extraKeyPages };
}
