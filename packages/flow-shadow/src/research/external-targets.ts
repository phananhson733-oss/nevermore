import type { ContentShadowExternalResearchTarget } from "../types.ts";

export const MAX_CONTENT_BRIEF_EXTERNAL_TARGETS = 8;
const MAX_EXTERNAL_TARGET_URL_CHARS = 2_048;
const MAX_EXTERNAL_TARGET_REF_CHARS = 500;

const FENCED_CODE = /^(?: {0,3})(`{3,}|~{3,})[^\n]*\n[\s\S]*?^(?: {0,3})\1[ \t]*$/gmu;
const INLINE_CODE = /`[^`\n]*`/gu;
const MARKDOWN_LINK =
  /\[([^\]\n]{1,500})\]\(\s*(https?:\/\/[^\s)]+)(?:\s+["'][^)]*["'])?\s*\)/giu;
const BARE_URL = /https?:\/\/[^\s<>()[\]`]+/giu;
const TRAILING_PROSE_PUNCTUATION = /[.,;:!?'"”’}\]]+$/u;

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function ipv4Octets(hostname: string): readonly number[] | null {
  const pieces = hostname.split(".");
  if (pieces.length !== 4) return null;
  const values = pieces.map((piece) => Number(piece));
  return values.every(
    (value) => Number.isInteger(value) && value >= 0 && value <= 255,
  )
    ? values
    : null;
}

/**
 * Cheap, deterministic pre-filter for targets that can never be public-web
 * research. The network adapter still performs DNS/IP classification on every
 * hop; this keeps an unsafe literal out of the frozen approved-target list in
 * the first place.
 */
function isObviouslyNonPublicHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local") ||
    host.endsWith(".internal") ||
    host.endsWith(".home.arpa") ||
    !host.includes(".")
  ) {
    return true;
  }
  // URL canonicalization retains brackets around IPv6 literals. Conservatively
  // leave all IP-literal IPv6 research to named public hosts instead.
  if (host.includes(":") || host.startsWith("[") || host.endsWith("]")) {
    return true;
  }
  const octets = ipv4Octets(host);
  if (octets === null) return false;
  const [a = 0, b = 0, c = 0] = octets;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113)
  );
}

function canonicalPublicUrl(raw: string): URL | null {
  const withoutPunctuation = raw.replace(TRAILING_PROSE_PUNCTUATION, "");
  if (withoutPunctuation.length > MAX_EXTERNAL_TARGET_URL_CHARS) return null;
  try {
    const parsed = new URL(withoutPunctuation);
    if (
      (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
      parsed.username.length > 0 ||
      parsed.password.length > 0
    ) {
      return null;
    }
    // A trailing DNS root dot is an equivalent spelling of the same hostname,
    // not an independently researchable external property.
    parsed.hostname = parsed.hostname.toLowerCase().replace(/\.$/u, "");
    if (isObviouslyNonPublicHost(parsed.hostname)) return null;
    parsed.hash = "";
    return parsed;
  } catch {
    return null;
  }
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  const mask = 0xffffffffffffffffn;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = (hash * prime) & mask;
  }
  return hash.toString(16).padStart(16, "0");
}

function stableTargetRef(url: string): string {
  const readable = `content-brief-link:${url}`;
  return readable.length <= MAX_EXTERNAL_TARGET_REF_CHARS
    ? readable
    : `content-brief-link:hash:${fnv1a64(url)}`;
}

function firstPartyHosts(origins: readonly string[]): ReadonlySet<string> {
  const hosts = new Set<string>();
  for (const origin of origins) {
    const parsed = canonicalPublicUrl(origin);
    if (parsed) hosts.add(parsed.hostname.toLowerCase());
  }
  return hosts;
}

function isFirstPartyHost(
  hostname: string,
  ownHosts: ReadonlySet<string>,
): boolean {
  const normalized = hostname.toLowerCase();
  return ownHosts.has(normalized);
}

function cleanLabel(raw: string): string {
  return raw
    .replace(/[*_~]/gu, "")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 300);
}

/**
 * Pure helper for the content-brief integration layer. It does not fetch or
 * inspect a URL; it only turns explicit public links into stable frozen
 * targets. The stable ref is URL-derived so reordering the brief cannot retarget
 * an already retrieved snapshot.
 */
export function extractContentBriefExternalTargets(input: {
  readonly briefMarkdown: string;
  readonly firstPartyOrigins?: readonly string[];
  readonly maxTargets?: number;
}): readonly ContentShadowExternalResearchTarget[] {
  const maxTargets =
    input.maxTargets ?? MAX_CONTENT_BRIEF_EXTERNAL_TARGETS;
  if (
    !Number.isSafeInteger(maxTargets) ||
    maxTargets < 0 ||
    maxTargets > MAX_CONTENT_BRIEF_EXTERNAL_TARGETS
  ) {
    throw new RangeError(
      `maxTargets must be an integer from 0 to ${MAX_CONTENT_BRIEF_EXTERNAL_TARGETS}`,
    );
  }

  const prose = input.briefMarkdown
    .replace(FENCED_CODE, "")
    .replace(INLINE_CODE, "");
  const ownHosts = firstPartyHosts(input.firstPartyOrigins ?? []);
  const labelsByUrl = new Map<string, Set<string>>();
  const add = (rawUrl: string, rawLabel: string | null): void => {
    const parsed = canonicalPublicUrl(rawUrl);
    if (!parsed || isFirstPartyHost(parsed.hostname, ownHosts)) return;
    const url = parsed.toString();
    const labels = labelsByUrl.get(url) ?? new Set<string>();
    const label = cleanLabel(rawLabel ?? "");
    labels.add(label.length > 0 ? label : parsed.hostname.toLowerCase());
    labelsByUrl.set(url, labels);
  };

  for (const match of prose.matchAll(MARKDOWN_LINK)) {
    add(match[2] ?? "", match[1] ?? null);
  }
  for (const match of prose.matchAll(BARE_URL)) {
    add(match[0], null);
  }

  return [...labelsByUrl.entries()]
    .sort(([left], [right]) => compareText(left, right))
    .slice(0, maxTargets)
    .map(([url, labels]) => ({
      ref: stableTargetRef(url),
      kind: "content_brief_link",
      url,
      label: [...labels].sort(compareText)[0] ?? new URL(url).hostname,
    }));
}
