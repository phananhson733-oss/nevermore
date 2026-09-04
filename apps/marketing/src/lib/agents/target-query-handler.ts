// @input  -- an authenticated Agent POST naming one inspected page URL
// @output -- Search Console queries that page earned impressions for, or a typed reason there are none
// @pos    -- reads the visitor's own grant; issues no credential and writes nothing
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { normalizeSeoAuditUrl } from "@sf/public-tools";
import { getServerAuthenticatedUser } from "../auth/server-auth-user.ts";
import { consumePublicToolQuota } from "../tools/shared-rate-limit.ts";
import { resolveTrafficDropGrant } from "../tools/traffic-drop-session.ts";
import {
  createTargetQueryCandidateReader,
  type TargetQueryCandidatesRead,
} from "./target-query-candidates.ts";

const REQUEST_BODY_LIMIT_BYTES = 4_096;

/**
 * Reads per signed-in account per hour.
 *
 * Deliberately NOT the shared per-IP gate the public Search Console tools use.
 * That gate exists because an anonymous caller in a loop spends quota counted
 * per GCP project rather than per visitor, and ten an hour is generous for a
 * person and useless for a loop. An Agent caller is signed in, so the account
 * is the thing to bound: two people behind one office NAT would otherwise
 * share ten calls between them, and one of them would be refused for the
 * other's work.
 *
 * Thirty is well above what the surface can spend -- an audit reads candidates
 * for one page -- and still far under what a loop would need to matter. The
 * shared project quota stays protected because the bound is per account and
 * every account here is a real one.
 */
const ACCOUNT_MAX_READS = 30;
const ACCOUNT_WINDOW_SECONDS = 60 * 60;

export function targetQueryQuotaBucket(userId: string): string {
  return `agent-target-query:${userId}`;
}

/**
 * Wall-clock left for the Search Console read.
 *
 * Under the route's own 30s, so a slow property degrades into "unavailable"
 * -- which this contract can say -- rather than into a platform kill, where no
 * envelope survives and the panel shows nothing at all.
 */
const READ_BUDGET_MS = 20_000;

export interface AgentTargetQueryDependencies {
  readonly readUser: typeof getServerAuthenticatedUser;
  readonly consumeQuota: typeof consumePublicToolQuota;
  readonly resolveGrant: typeof resolveTrafficDropGrant;
  readonly now: () => number;
}

export const DEFAULT_TARGET_QUERY_DEPENDENCIES: AgentTargetQueryDependencies = {
  readUser: getServerAuthenticatedUser,
  consumeQuota: consumePublicToolQuota,
  resolveGrant: resolveTrafficDropGrant,
  now: Date.now,
};

function json(body: unknown, status = 200): Response {
  return Response.json(body, {
    status,
    headers: { "Cache-Control": "no-store, private" },
  });
}

function error(code: string, status: number): Response {
  return json({ error: code }, status);
}

export async function handleAgentTargetQueryRequest(
  request: Request,
  dependencies: AgentTargetQueryDependencies = DEFAULT_TARGET_QUERY_DEPENDENCIES,
): Promise<Response> {
  let user;
  try {
    user = await dependencies.readUser();
  } catch {
    return error("auth_unavailable", 503);
  }
  if (user.status !== "authenticated") {
    return error(
      user.status === "unauthenticated" ? "auth_required" : "auth_unavailable",
      user.status === "unauthenticated" ? 401 : 503,
    );
  }

  /*
    Fails closed, like the sibling gate: an endpoint that spends a shared
    upstream budget with no working limiter is worse than one that is briefly
    unavailable. The visitor turned away comes back; exhausted project quota
    takes Search Console down for every tool at once.
  */
  const quota = await dependencies.consumeQuota(
    targetQueryQuotaBucket(user.userId),
    ACCOUNT_MAX_READS,
    ACCOUNT_WINDOW_SECONDS,
  );
  if (quota.kind === "unavailable") return error("quota_unavailable", 503);
  if (quota.kind === "limited") {
    return Response.json(
      { error: "rate_limited" },
      {
        status: 429,
        headers: {
          "Cache-Control": "no-store, private",
          "Retry-After": String(quota.retryAfterSeconds),
        },
      },
    );
  }

  const raw = await request.text();
  if (raw.length > REQUEST_BODY_LIMIT_BYTES) return error("payload_too_large", 413);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return error("invalid_request", 400);
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("url" in parsed) ||
    typeof (parsed as { url: unknown }).url !== "string"
  ) {
    return error("invalid_request", 400);
  }

  const normalized = normalizeSeoAuditUrl((parsed as { url: string }).url);
  if (!normalized.ok) return error("invalid_url", 400);

  /*
    The grant is the visitor's own, read from the `/api`-scoped cookie the
    consent flow wrote. Nothing here can create one: a visitor without a grant
    is sent to the consent screen by the panel, not signed up by this route.
  */
  const grant = await dependencies.resolveGrant({});
  if (grant.kind !== "grant") {
    const read: TargetQueryCandidatesRead =
      grant.kind === "unavailable" ? { kind: "unavailable" } : { kind: "no_grant" };
    return json({ data: read });
  }

  const readCandidates = createTargetQueryCandidateReader({
    deadlineAt: dependencies.now() + READ_BUDGET_MS,
  });

  const data = await readCandidates({
    inspectedUrl: normalized.url,
    accessToken: grant.accessToken,
    properties: grant.properties,
  });

  return json({ data });
}
