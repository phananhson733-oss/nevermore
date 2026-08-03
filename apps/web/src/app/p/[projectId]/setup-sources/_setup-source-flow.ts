import type { GoogleProvider } from "@/lib/api/hooks-sources";

export interface SetupSourceReturnParams {
  readonly provider: GoogleProvider | null;
  readonly oauthIntentId: string | null;
  readonly error: string | null;
}

type SearchParamValue = string | readonly string[] | undefined;

function first(value: SearchParamValue): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return typeof value === "string" ? value : null;
}

function provider(value: string | null): GoogleProvider | null {
  return value === "gsc" || value === "ga4" ? value : null;
}

function uuid(value: string | null): string | null {
  return value !== null &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      value,
    )
    ? value
    : null;
}

export function parseSetupSourceReturnParams(
  searchParams: Readonly<Record<string, SearchParamValue>>,
): SetupSourceReturnParams {
  const oauthIntentId = uuid(first(searchParams["oauthIntentId"]));
  const oauthProvider = provider(first(searchParams["provider"]));
  const rawError = first(searchParams["error"]);
  return {
    provider:
      oauthIntentId !== null && oauthProvider !== null ? oauthProvider : null,
    oauthIntentId:
      oauthIntentId !== null && oauthProvider !== null ? oauthIntentId : null,
    error:
      typeof rawError === "string" && /^[A-Z0-9_]{1,80}$/u.test(rawError)
        ? rawError
        : null,
  };
}

export function setupSourcesPath(projectId: string): string {
  return `/p/${encodeURIComponent(projectId)}/setup-sources`;
}

export function productProfilePath(projectId: string): string {
  return `/p/${encodeURIComponent(projectId)}/context`;
}
