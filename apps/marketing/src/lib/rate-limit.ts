// @input  -- key (user/ip scoped), max requests, window size in ms; request Headers (for IP extraction)
// @output -- { allowed, remaining, resetAt, retryAfterSeconds } using in-memory fixed-window counter; lazy sweep when store > MAX_STORE_SIZE prevents memory leak (W3a.0b /review round 3 fix #6); extractClientIp(headers) hardened IP for per-IP buckets (shared single source — SV #165 Codex IP-spoofing fix)
// @pos    -- request rate limiter shared by API routes (SPEC 3.3 Phase 1.9)
// Once this file is updated, update the header comment and the folder's _DIR.md
//
// Serverless note: this is an in-memory counter. On Vercel each isolate keeps
// its own store, so the real limit is ~N_isolates × max. That is acceptable as
// a first-step guard against casual abuse. Move to Upstash Redis when we need
// correctness across instances.

interface BucketState {
  windowStart: number;
  count: number;
  windowMs: number; // remembered for sweep (entry expired iff now - windowStart >= windowMs)
}

export interface RateLimitResult {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly resetAt: number;
  readonly retryAfterSeconds: number;
}

const store: Map<string, BucketState> = new Map();

// Anti memory-leak (round 3 fix #6): on a long-running Vercel Function
// instance with churning user IDs, the Map grows unboundedly. When we exceed
// this threshold, opportunistically sweep expired entries on the next set().
// 5000 keys × ~64 bytes = ~320KB worst case before sweep — well below isolate
// memory budget but still a useful ceiling.
const MAX_STORE_SIZE = 5_000;

function sweepExpired(now: number): void {
  for (const [k, v] of store) {
    if (now - v.windowStart >= v.windowMs) {
      store.delete(k);
    }
  }
}

export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number,
): RateLimitResult {
  const now = Date.now();
  const existing = store.get(key);

  if (!existing || now - existing.windowStart >= windowMs) {
    // Opportunistic sweep BEFORE adding the new entry — keeps the store
    // bounded across long-lived instances. Cost: O(n) walk amortized over
    // every MAX_STORE_SIZE-th request, ~few ms at the limit.
    if (store.size >= MAX_STORE_SIZE) {
      sweepExpired(now);
    }
    store.set(key, { windowStart: now, count: 1, windowMs });
    return {
      allowed: true,
      remaining: max - 1,
      resetAt: now + windowMs,
      retryAfterSeconds: 0,
    };
  }

  const resetAt = existing.windowStart + windowMs;

  if (existing.count >= max) {
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfterSeconds: Math.max(1, Math.ceil((resetAt - now) / 1000)),
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: max - existing.count,
    resetAt,
    retryAfterSeconds: 0,
  };
}

export function resetRateLimitStore(): void {
  store.clear();
}

/**
 * Extract the client IP from incoming request headers for use as a per-IP
 * rate-limit bucket key. Shared single source of truth across API routes.
 *
 * Order of preference (hardened — prevents X-Forwarded-For spoofing):
 *   1. `x-real-ip` — Vercel injects this AFTER stripping client-supplied
 *      copies, so it's the trustworthy single signal when present.
 *   2. Last hop of `x-forwarded-for` — closest to the platform. Earlier hops
 *      can be attacker-controlled prefixes because Vercel only appends to
 *      X-Forwarded-For; it does NOT strip a client-supplied copy.
 *   3. `"unknown"` sentinel (local dev / direct connection).
 *
 * Why NOT first hop (`split(",")[0]`): on Vercel, an attacker who sends
 * `X-Forwarded-For: <spoofed>` lands at position 0 of the resulting list, so
 * rotating the spoofed prefix on every request would scatter their traffic
 * across distinct buckets and defeat the per-IP limit entirely. Last hop is
 * the IP the platform actually observed, so the bucket holds.
 *
 * IPv6 is truncated to its /64 prefix (first 4 hextets) so an attacker cannot
 * rotate the trailing 64 bits to escape a single bucket.
 */
export function extractClientIp(headers: Headers): string {
  let raw: string | null = null;

  const real = headers.get("x-real-ip");
  if (real?.trim()) {
    raw = real.trim();
  }

  if (!raw) {
    const forwarded = headers.get("x-forwarded-for");
    if (forwarded) {
      const hops = forwarded
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (hops.length > 0) {
        raw = hops[hops.length - 1] ?? null;
      }
    }
  }

  if (!raw) return "unknown";

  // IPv6 detection: contains a colon. Truncate to the /64 network prefix so an
  // attacker cannot rotate the trailing 64 host bits to escape a single bucket.
  if (raw.includes(":")) {
    return truncateIpv6To64(raw);
  }

  return raw;
}

// /64 truncation that first expands "::" zero-compression to the full 8
// hextets, then takes the first 4. Security/review fix: a textual
// `split(":").slice(0,4)` left compressed forms intact, so `2001:db8::1` and
// `2001:db8::2` landed in DIFFERENT buckets — defeating the /64 guard. The
// platform injects a consistent IP spelling, so per-hextet normalization is
// unnecessary; "::" expansion is the load-bearing fix. Malformed input
// (negative fill / too few hextets) is returned as-is (own bucket).
function truncateIpv6To64(ip: string): string {
  const dc = ip.indexOf("::");
  let hextets: string[];
  if (dc !== -1) {
    const left = ip
      .slice(0, dc)
      .split(":")
      .filter((h) => h.length > 0);
    const right = ip
      .slice(dc + 2)
      .split(":")
      .filter((h) => h.length > 0);
    const missing = 8 - left.length - right.length;
    if (missing < 0) return ip;
    hextets = [...left, ...Array(missing).fill("0"), ...right];
  } else {
    hextets = ip.split(":");
  }
  if (hextets.length < 4) return ip;
  return hextets.slice(0, 4).join(":");
}

// Test-only — exported for assertion of the sweep-on-overflow behavior.
// Underscore prefix signals "not part of the public surface; do not call
// from production code."
export function _internalStoreSize(): number {
  return store.size;
}
