// @input  -- browser sessionStorage, exact Agent identity, URL, and current time
// @output -- safe storage plus purpose-versioned, ten-minute Agent-local intents
// @pos    -- homepage Profile preparation and auth-resume handoff without auto-run ambiguity

import type { AgentKind } from "./agent-types";
import {
  isAgentProfileDraft,
  isConfirmedAgentProfile,
  type AgentProfileDraft,
} from "./agent-profile";

/** The sign-in handoff must never outlive ten minutes in this browser tab. */
export const AGENT_INTENT_TTL_MS = 10 * 60 * 1_000;

interface IntentStorage {
  readonly getItem: (key: string) => string | null;
  readonly setItem: (key: string, value: string) => void;
  readonly removeItem: (key: string) => void;
}

type SessionStorageProvider = {
  readonly sessionStorage: IntentStorage;
};

/**
 * Access to Web Storage can itself throw (for example, when browser policy
 * disables persistence). Treat that as an unavailable UX handoff, not a page
 * failure; the server remains authoritative for authentication and each run.
 */
export function getSessionIntentStorage(
  browser: SessionStorageProvider | undefined =
    typeof window === "undefined" ? undefined : window,
): IntentStorage | null {
  if (!browser) return null;
  try {
    return browser.sessionStorage;
  } catch {
    return null;
  }
}

export type PendingAgentIntentPurpose =
  | "prepare_profile"
  | "run_confirmed_profile"
  | "refresh_profile";

export type AgentProfileRefreshMode = "prefer_cache" | "refresh";

export interface PendingAgentIntent {
  readonly agent: AgentKind;
  readonly purpose: PendingAgentIntentPurpose;
  readonly url: string;
  readonly createdAt: number;
  readonly expiresAt: number;
  /** Present only for a confirmed run interrupted by authentication. */
  readonly confirmedProfile?: AgentProfileDraft;
  /** Present only for a profile refresh request that must never auto-run audit. */
  readonly refreshProfile?: AgentProfileDraft;
  readonly refreshMode?: AgentProfileRefreshMode;
}

export function pendingAgentIntentKey(agent: AgentKind): string {
  return `gengrowth:agent-intent:${agent}:v2`;
}

function legacyPendingAgentIntentKey(agent: AgentKind): string {
  return `gengrowth:agent-intent:${agent}:v1`;
}

function isPendingIntent(
  value: unknown,
  agent: AgentKind,
): value is PendingAgentIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<PendingAgentIntent>;
  const purposeIsKnown =
    candidate.purpose === "prepare_profile" ||
    candidate.purpose === "run_confirmed_profile" ||
    candidate.purpose === "refresh_profile";
  const confirmedProfileIsValid =
    candidate.confirmedProfile === undefined ||
    (candidate.purpose === "run_confirmed_profile" &&
      isConfirmedAgentProfile(candidate.confirmedProfile, agent, candidate.url));
  const refreshProfileIsValid =
    candidate.purpose !== "refresh_profile"
      ? candidate.refreshProfile === undefined &&
        candidate.refreshMode === undefined
      : isRefreshProfileDraft(candidate.refreshProfile, agent, candidate.url) &&
        isRefreshMode(candidate.refreshMode);
  return (
    candidate.agent === agent &&
    purposeIsKnown &&
    typeof candidate.url === "string" &&
    candidate.url.trim().length > 0 &&
    candidate.url.length <= 2_048 &&
    typeof candidate.createdAt === "number" &&
    Number.isFinite(candidate.createdAt) &&
    typeof candidate.expiresAt === "number" &&
    Number.isFinite(candidate.expiresAt) &&
    candidate.expiresAt > candidate.createdAt &&
    candidate.expiresAt - candidate.createdAt <= AGENT_INTENT_TTL_MS &&
    confirmedProfileIsValid &&
    refreshProfileIsValid
  );
}

function isRefreshMode(value: unknown): value is AgentProfileRefreshMode {
  return value === "prefer_cache" || value === "refresh";
}

function isCanonicalLanguageTag(value: string): boolean {
  if (!value || value.length > 35) return false;
  try {
    return Intl.getCanonicalLocales(value)[0] === value;
  } catch {
    return false;
  }
}

function isRefreshProfileDraft(
  value: unknown,
  agent: AgentKind,
  exactUrl: unknown,
): value is AgentProfileDraft {
  if (typeof exactUrl !== "string" || !isAgentProfileDraft(value, agent, exactUrl)) {
    return false;
  }
  return (
    /^[A-Z]{2}$/.test(value.country) &&
    isCanonicalLanguageTag(value.locale)
  );
}

/**
 * The numeric fourth argument is retained for the existing auth handoff while
 * callers migrate. New acquisition surfaces must pass an explicit purpose.
 */
export function storePendingAgentIntent(
  storage: IntentStorage,
  agent: AgentKind,
  url: string,
  purposeOrNow: PendingAgentIntentPurpose | number = "run_confirmed_profile",
  explicitNow = Date.now(),
): PendingAgentIntent | null {
  const purpose =
    typeof purposeOrNow === "number"
      ? "run_confirmed_profile"
      : purposeOrNow;
  const now = typeof purposeOrNow === "number" ? purposeOrNow : explicitNow;
  if (!url.trim() || url.length > 2_048 || !Number.isFinite(now)) return null;
  const intent: PendingAgentIntent = {
    agent,
    purpose,
    url: url.trim(),
    createdAt: now,
    expiresAt: now + AGENT_INTENT_TTL_MS,
  };
  try {
    storage.removeItem(legacyPendingAgentIntentKey(agent));
    storage.setItem(pendingAgentIntentKey(agent), JSON.stringify(intent));
    return intent;
  } catch {
    return null;
  }
}

/** Store the exact, already-confirmed local snapshot for an auth-interrupted run. */
export function storeConfirmedAgentRunIntent(
  storage: IntentStorage,
  profile: AgentProfileDraft,
  now = Date.now(),
): PendingAgentIntent | null {
  if (!isConfirmedAgentProfile(profile, profile.agent, profile.targetUrl)) {
    return null;
  }
  const intent: PendingAgentIntent = {
    agent: profile.agent,
    purpose: "run_confirmed_profile",
    url: profile.targetUrl,
    createdAt: now,
    expiresAt: now + AGENT_INTENT_TTL_MS,
    confirmedProfile: profile,
  };
  if (!Number.isFinite(now) || !isPendingIntent(intent, profile.agent)) return null;
  try {
    storage.removeItem(legacyPendingAgentIntentKey(profile.agent));
    storage.setItem(
      pendingAgentIntentKey(profile.agent),
      JSON.stringify(intent),
    );
    return intent;
  } catch {
    return null;
  }
}

/** Store the exact local draft for an authenticated profile refresh request. */
export function storeAgentProfileRefreshIntent(
  storage: IntentStorage,
  profile: AgentProfileDraft,
  mode: AgentProfileRefreshMode,
  now = Date.now(),
): PendingAgentIntent | null {
  const intent: PendingAgentIntent = {
    agent: profile.agent,
    purpose: "refresh_profile",
    url: profile.targetUrl,
    createdAt: now,
    expiresAt: now + AGENT_INTENT_TTL_MS,
    refreshProfile: profile,
    refreshMode: mode,
  };
  if (!Number.isFinite(now) || !isPendingIntent(intent, profile.agent)) return null;
  try {
    storage.removeItem(legacyPendingAgentIntentKey(profile.agent));
    storage.setItem(
      pendingAgentIntentKey(profile.agent),
      JSON.stringify(intent),
    );
    return intent;
  } catch {
    return null;
  }
}

/** A homepage preparation intent is data for Stage 01, never permission to POST. */
export function isRunnablePendingAgentIntent(
  intent: PendingAgentIntent,
): boolean {
  return (
    intent.purpose === "run_confirmed_profile" &&
    isConfirmedAgentProfile(intent.confirmedProfile, intent.agent, intent.url)
  );
}

export function isProfileRefreshPendingAgentIntent(
  intent: PendingAgentIntent,
): intent is PendingAgentIntent & {
  readonly purpose: "refresh_profile";
  readonly refreshProfile: AgentProfileDraft;
  readonly refreshMode: AgentProfileRefreshMode;
} {
  return (
    intent.purpose === "refresh_profile" &&
    isRefreshMode(intent.refreshMode) &&
    isRefreshProfileDraft(intent.refreshProfile, intent.agent, intent.url)
  );
}

/** Restore the same still-live intent after an API-level auth race. */
export function restorePendingAgentIntent(
  storage: IntentStorage,
  agent: AgentKind,
  intent: PendingAgentIntent,
  now = Date.now(),
): PendingAgentIntent | null {
  if (
    !Number.isFinite(now) ||
    !isPendingIntent(intent, agent) ||
    intent.createdAt > now ||
    intent.expiresAt <= now
  ) {
    return null;
  }
  try {
    storage.removeItem(legacyPendingAgentIntentKey(agent));
    storage.setItem(pendingAgentIntentKey(agent), JSON.stringify(intent));
    return intent;
  } catch {
    return null;
  }
}

/**
 * Read only this Agent's slot. A malformed, mismatched, or expired value is
 * deleted so it cannot be reconsidered on a later navigation.
 */
export function readPendingAgentIntent(
  storage: IntentStorage,
  agent: AgentKind,
  now = Date.now(),
): PendingAgentIntent | null {
  const key = pendingAgentIntentKey(agent);
  let raw: string | null = null;
  try {
    // v1 had no purpose. Delete rather than guess whether it was a homepage
    // prefill or a visitor-confirmed run.
    storage.removeItem(legacyPendingAgentIntentKey(agent));
    raw = storage.getItem(key);
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (
      !Number.isFinite(now) ||
      !isPendingIntent(parsed, agent) ||
      parsed.createdAt > now ||
      parsed.expiresAt <= now
    ) {
      storage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    try {
      storage.removeItem(key);
    } catch {
      // A disabled storage surface is equivalent to no resumable intent.
    }
    return null;
  }
}

/** Trigger the existing fail-closed read at this handoff's expiry deadline. */
export function schedulePendingAgentIntentExpiry(
  storage: IntentStorage,
  intent: PendingAgentIntent,
): void {
  const agent = intent.agent;
  const delay = Math.max(0, intent.expiresAt - Date.now());
  setTimeout(() => {
    readPendingAgentIntent(storage, agent);
  }, delay);
}

export function clearPendingAgentIntent(
  storage: IntentStorage,
  agent: AgentKind,
): void {
  try {
    storage.removeItem(pendingAgentIntentKey(agent));
    storage.removeItem(legacyPendingAgentIntentKey(agent));
  } catch {
    // The server still authorizes every run; storage is only a UX handoff.
  }
}
