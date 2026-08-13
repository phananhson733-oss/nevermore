// @input  -- browser sessionStorage, exact Agent identity, URL, and current time
// @output -- safe storage acquisition plus ten-minute, Agent-isolated pending run intents
// @pos    -- small browser-session handoff across Google/Supabase sign-in reloads

import type { AgentKind } from "./agent-types";

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

export interface PendingAgentIntent {
  readonly agent: AgentKind;
  readonly url: string;
  readonly createdAt: number;
  readonly expiresAt: number;
}

export function pendingAgentIntentKey(agent: AgentKind): string {
  return `gengrowth:agent-intent:${agent}:v1`;
}

function isPendingIntent(
  value: unknown,
  agent: AgentKind,
): value is PendingAgentIntent {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<PendingAgentIntent>;
  return (
    candidate.agent === agent &&
    typeof candidate.url === "string" &&
    candidate.url.trim().length > 0 &&
    candidate.url.length <= 2_048 &&
    typeof candidate.createdAt === "number" &&
    Number.isFinite(candidate.createdAt) &&
    typeof candidate.expiresAt === "number" &&
    Number.isFinite(candidate.expiresAt) &&
    candidate.expiresAt > candidate.createdAt &&
    candidate.expiresAt - candidate.createdAt <= AGENT_INTENT_TTL_MS
  );
}

export function storePendingAgentIntent(
  storage: IntentStorage,
  agent: AgentKind,
  url: string,
  now = Date.now(),
): PendingAgentIntent | null {
  if (!url.trim() || url.length > 2_048 || !Number.isFinite(now)) return null;
  const intent: PendingAgentIntent = {
    agent,
    url,
    createdAt: now,
    expiresAt: now + AGENT_INTENT_TTL_MS,
  };
  try {
    storage.setItem(pendingAgentIntentKey(agent), JSON.stringify(intent));
    return intent;
  } catch {
    return null;
  }
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

export function clearPendingAgentIntent(
  storage: IntentStorage,
  agent: AgentKind,
): void {
  try {
    storage.removeItem(pendingAgentIntentKey(agent));
  } catch {
    // The server still authorizes every run; storage is only a UX handoff.
  }
}
