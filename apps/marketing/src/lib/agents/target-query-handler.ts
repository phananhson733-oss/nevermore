// @input  -- an authenticated Agent POST naming one inspected page URL
// @output -- Search Console queries that page earned impressions for, or a typed reason there are none
// @pos    -- reads the visitor's own grant; issues no credential and writes nothing
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { normalizeSeoAuditUrl } from "@sf/public-tools";
import {
  getServerAuthenticationStatus,
  type ServerAuthenticationStatus,
} from "../auth/server-auth-status.ts";
import { resolveTrafficDropGrant } from "../tools/traffic-drop-session.ts";
import {
  createTargetQueryCandidateReader,
  type TargetQueryCandidatesRead,
} from "./target-query-candidates.ts";

const REQUEST_BODY_LIMIT_BYTES = 4_096;

/**
 * Wall-clock left for the Search Console read.
 *
 * Under the route's own 30s, so a slow property degrades into "unavailable"
 * -- which this contract can say -- rather than into a platform kill, where no
 * envelope survives and the panel shows nothing at all.
 */
const READ_BUDGET_MS = 20_000;

export interface AgentTargetQueryDependencies {
  readonly authenticate: () => Promise<ServerAuthenticationStatus>;
  readonly resolveGrant: typeof resolveTrafficDropGrant;
  readonly now: () => number;
}

export const DEFAULT_TARGET_QUERY_DEPENDENCIES: AgentTargetQueryDependencies = {
  authenticate: getServerAuthenticationStatus,
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
  let authentication: ServerAuthenticationStatus = "unavailable";
  try {
    authentication = await dependencies.authenticate();
  } catch {
    authentication = "unavailable";
  }
  if (authentication === "unavailable") return error("auth_unavailable", 503);
  if (authentication === "unauthenticated") return error("auth_required", 401);

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
