"use client";

/**
 * TanStack Query v5 hooks for the Sources data-hub screen (spec §4.2, §7).
 * Mirrors the shared hook style in `./hooks.ts`: query hooks unwrap the `{ data }`
 * envelope, mutations mint a fresh `Idempotency-Key` per attempt, and successful
 * writes invalidate the affected server-state keys (TanStack Query owns
 * server-state, never a hand-rolled store — spec §3.2).
 *
 * The DTOs below are hand-authored against `openapi/mvp.yaml` (the machine
 * contract) and kept `readonly`: fetched state is cached and must not be mutated
 * in place. `unavailable != 0` (spec §1.3): a source can be `connected` without a
 * usable snapshot, so `latestSnapshot`/`activeRun` are honestly nullable.
 */

import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type InfiniteData,
  type UseInfiniteQueryResult,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import { ApiError, apiGet, apiSend } from "./client";
import type { DataEnvelope, ListEnvelope, ProblemBody } from "./types";
import { BASE_PATH } from "@/lib/base-path";
import { cursorPageUrl, nextCursorPageParam } from "./cursor-pages";

const API_BASE = `${BASE_PATH}/api/mvp`;

// --------------------------------------------------------------- Enums -------

export type Provider = "crawl" | "gsc" | "ga4" | "csv" | "dataforseo";
/** The two OAuth (Google) providers `connect`/property-selection applies to. */
export type GoogleProvider = "gsc" | "ga4";
/** Providers that accept a `collection-runs` POST (CSV collects via import). */
export type CollectionProvider = "crawl" | "gsc" | "ga4" | "dataforseo";
export type ConnectionType =
  | "public"
  | "oauth"
  | "file_import"
  | "api_key_stub";
export type SourceState =
  | "connecting"
  | "connected"
  | "syncing"
  | "available"
  | "partial"
  | "stale"
  | "permission_denied"
  | "unavailable"
  | "disconnected";
export type Availability = "available" | "partial" | "unavailable";
export type RunKind =
  | "collection"
  | "diagnostic"
  | "artifact_generation"
  | "export";
export type RunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

/** Terminal run states: polling stops and Sources is refetched once reached. */
const TERMINAL_RUN_STATES: readonly RunStatus[] = [
  "completed",
  "partial",
  "failed",
  "cancelled",
];

export function isTerminalRunStatus(status: RunStatus): boolean {
  return TERMINAL_RUN_STATES.includes(status);
}

// ---------------------------------------------------------------- DTOs -------

export interface SnapshotWindow {
  readonly start: string | null;
  readonly end: string | null;
}

/** An immutable collected dataset (OpenAPI `DataSnapshot`). */
export interface DataSnapshot {
  readonly id: string;
  readonly siteId: string;
  readonly provider: Provider;
  readonly datasetKey: string;
  readonly schemaVersion: string;
  readonly methodVersion: string;
  readonly capturedAt: string;
  readonly sourceWindow: SnapshotWindow;
  readonly availability: Availability;
  readonly limitation: string;
  readonly rowCount: number;
  readonly checksum: string;
}

export interface RunProgress {
  readonly phase: string;
  readonly current: number;
  readonly total: number | null;
  readonly messageKey: string;
}

export interface RunError {
  readonly code: string;
  readonly summary: string;
}

export interface RunResourceRef {
  readonly type: "collection_run" | "diagnostic_run" | "artifact" | "export";
  readonly id: string;
}

/** A queued/running/terminal async job projection (OpenAPI `AsyncRun`). */
export interface AsyncRun {
  readonly id: string;
  readonly projectId: string;
  readonly kind: RunKind;
  readonly status: RunStatus;
  readonly progress: RunProgress;
  readonly lastError: RunError | null;
  readonly resultRef: RunResourceRef | null;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

/** One of the five MVP source capabilities (OpenAPI `SourceConnection`). */
export interface SourceConnection {
  readonly id: string | null;
  readonly projectId: string;
  readonly provider: Provider;
  readonly connectionType: ConnectionType;
  readonly state: SourceState;
  readonly externalRef: string | null;
  readonly scopes: readonly string[];
  readonly connectedAt: string | null;
  readonly latestSnapshot: DataSnapshot | null;
  readonly activeRun: AsyncRun | null;
  readonly limitation: string;
  readonly featureEnabled: boolean;
  readonly updatedAt: string;
}

/** The `{ run, statusUrl, resourceRef }` body of every async 202 (spec §11.2). */
export interface AsyncAcceptedData {
  readonly run: AsyncRun;
  readonly statusUrl: string;
  readonly resourceRef: RunResourceRef | null;
}

// -- connect (OAuth) phases ---------------------------------------------------

export interface AuthorizationPhase {
  readonly phase: "authorization";
  readonly authorizationUrl: string;
  readonly expiresAt: string;
}

export interface PropertyCandidate {
  readonly id: string;
  readonly displayName: string;
}

export interface PropertySelectionPhase {
  readonly phase: "property_selection";
  readonly oauthIntentId: string;
  readonly provider: GoogleProvider;
  readonly properties: readonly PropertyCandidate[];
  readonly expiresAt: string;
}

export interface ConnectedPhase {
  readonly phase: "connected";
  readonly source: SourceConnection;
}

export type ConnectPhaseData =
  | AuthorizationPhase
  | PropertySelectionPhase
  | ConnectedPhase;

export type ConnectPhaseRequest =
  | { readonly phase: "authorize"; readonly returnPath: string }
  | { readonly phase: "property_selection"; readonly oauthIntentId: string }
  | {
      readonly phase: "select_property";
      readonly oauthIntentId: string;
      readonly externalPropertyId: string;
      readonly keyEventNames?: readonly string[];
    };

export interface ConnectSourceVariables {
  readonly provider: GoogleProvider;
  readonly request: ConnectPhaseRequest;
}

// -- CSV import ---------------------------------------------------------------

export interface CsvColumnMapping {
  readonly keyword: string;
  readonly searchVolume: string;
  readonly cluster?: string | null;
  readonly currentUrl?: string | null;
  readonly currentRank?: string | null;
  readonly competitorDomain?: string | null;
  readonly competitorRank?: string | null;
  readonly marketCode: string;
  readonly languageCode: string;
}

export interface ImportPreviewData {
  readonly importToken: string;
  readonly expiresAt: string;
  readonly rowCount: number;
  readonly previewRows: readonly Readonly<Record<string, unknown>>[];
  readonly detectedColumns: readonly string[];
  readonly suggestedMapping: Readonly<Record<string, string | null>>;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface ImportConfirmVariables {
  readonly importToken: string;
  readonly mapping: CsvColumnMapping;
}

export interface CreateCollectionRunVariables {
  readonly provider: CollectionProvider;
  readonly sourceConnectionId?: string | null;
}

// ------------------------------------------------------------- Query keys ----

const sourcesKey = (projectId: string): readonly unknown[] => [
  "sources",
  projectId,
];
const snapshotsKey = (projectId: string): readonly unknown[] => [
  "snapshots",
  projectId,
];
const runKey = (projectId: string, runId: string): readonly unknown[] => [
  "run",
  projectId,
  runId,
];

// ----------------------------------------------------------------- Queries ---

/**
 * The five source cards (crawl, gsc, ga4, csv, dataforseo) with capability,
 * state, latest snapshot, and active run. Returns the unwrapped array; the API
 * guarantees exactly five entries (one per provider).
 */
export function useProjectSources(
  projectId: string,
): UseQueryResult<readonly SourceConnection[], ApiError> {
  return useQuery({
    queryKey: sourcesKey(projectId),
    queryFn: async () => {
      const res = await apiGet<DataEnvelope<readonly SourceConnection[]>>(
        `/projects/${projectId}/sources`,
      );
      return res.data;
    },
    enabled: projectId.length > 0,
  });
}

/** Immutable snapshot history as bounded pages with each page's `meta` envelope. */
export function useProjectSnapshots(
  projectId: string,
): UseInfiniteQueryResult<
  InfiniteData<ListEnvelope<DataSnapshot>, string | null>,
  ApiError
> {
  return useInfiniteQuery({
    queryKey: snapshotsKey(projectId),
    queryFn: ({ pageParam }) =>
      apiGet<ListEnvelope<DataSnapshot>>(
        cursorPageUrl(`/projects/${projectId}/snapshots`, pageParam),
      ),
    initialPageParam: null as string | null,
    getNextPageParam: nextCursorPageParam,
    enabled: projectId.length > 0,
  });
}

const POLL_BACKOFF_MS: readonly number[] = [1000, 2000, 4000];
const POLL_STEADY_MS = 5000;

/**
 * Poll one run until it settles. `refetchInterval` backs off 1s → 2s → 4s → 5s
 * steady (derived from the per-query update count, so it resets when `runId`
 * changes) and returns `false` once the status is terminal;
 * `refetchIntervalInBackground: false` pauses polling while the tab is hidden. On
 * refresh the page re-derives the run id from the server projection, so polling
 * recovers without an in-memory statusUrl (spec §11.2).
 */
export function useProjectRun(
  projectId: string,
  runId: string,
): UseQueryResult<AsyncRun, ApiError> {
  return useQuery({
    queryKey: runKey(projectId, runId),
    queryFn: async () => {
      const res = await apiGet<DataEnvelope<AsyncRun>>(
        `/projects/${projectId}/runs/${runId}`,
      );
      return res.data;
    },
    enabled: projectId.length > 0 && runId.length > 0,
    refetchInterval: (query) => {
      // Stop polling if the status query itself errors (401/404/5xx) — otherwise
      // dataUpdateCount stays 0 and the 1s poll would loop forever (spec §11.1).
      if (query.state.status === "error") return false;
      const run = query.state.data;
      if (run !== undefined && isTerminalRunStatus(run.status)) return false;
      const idx = Math.max(0, query.state.dataUpdateCount - 1);
      return POLL_BACKOFF_MS[idx] ?? POLL_STEADY_MS;
    },
    refetchIntervalInBackground: false,
  });
}

// --------------------------------------------------------------- Mutations ---

/**
 * Queue one provider collection. Crawl may omit `sourceConnectionId` (the default
 * Crawl source fills it in); GSC/GA4 must pass their connected source. DataForSEO
 * may omit it because the server atomically provisions a secret-free project
 * connection for legacy projects. Returns the accepted run so the caller can
 * poll it; Sources is invalidated so the queued `activeRun` appears on the card.
 */
export function useCreateCollectionRun(
  projectId: string,
): UseMutationResult<
  AsyncAcceptedData,
  ApiError,
  CreateCollectionRunVariables
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: CreateCollectionRunVariables) => {
      const body: {
        provider: CollectionProvider;
        sourceConnectionId?: string;
      } = {
        provider: vars.provider,
      };
      if (vars.sourceConnectionId)
        body.sourceConnectionId = vars.sourceConnectionId;
      const res = await apiSend<DataEnvelope<AsyncAcceptedData>>(
        "POST",
        `/projects/${projectId}/collection-runs`,
        { body, idempotencyKey: crypto.randomUUID() },
      );
      return res.data;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: sourcesKey(projectId) }),
  });
}

/**
 * Drive the three-phase Google connect flow through the single connect endpoint:
 * `authorize` (→ redirect to `authorizationUrl`), `property_selection` (→ candidate
 * properties for the returned `oauthIntentId`), and `select_property` (→ a
 * `connected` source). On `connected`, Sources is invalidated.
 */
export function useConnectSource(
  projectId: string,
): UseMutationResult<ConnectPhaseData, ApiError, ConnectSourceVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ provider, request }: ConnectSourceVariables) => {
      const res = await apiSend<DataEnvelope<ConnectPhaseData>>(
        "POST",
        `/projects/${projectId}/sources/${provider}/connect`,
        { body: request },
      );
      return res.data;
    },
    onSuccess: (data) => {
      if (data.phase === "connected") {
        void queryClient.invalidateQueries({ queryKey: sourcesKey(projectId) });
      }
    },
  });
}

/** Coerce a non-2xx multipart response into a `ProblemBody` (mirrors the client). */
function toProblem(response: Response, body: unknown): ProblemBody {
  if (
    typeof body === "object" &&
    body !== null &&
    typeof (body as Record<string, unknown>).code === "string" &&
    typeof (body as Record<string, unknown>).status === "number"
  ) {
    return body as ProblemBody;
  }
  return {
    type: "about:blank",
    title: response.statusText || "Request failed",
    status: response.status,
    code: "UNKNOWN",
    detail: `Request failed with status ${response.status}.`,
    requestId: response.headers.get("X-Request-Id") ?? "",
  };
}

/**
 * CSV preview is `multipart/form-data`, which the shared JSON `apiSend` cannot
 * carry, so this posts the FormData directly while reusing `ApiError` for a
 * consistent typed failure. It never writes canonical observations (spec §7.5).
 */
async function importCsvPreview(
  projectId: string,
  file: File,
): Promise<ImportPreviewData> {
  const form = new FormData();
  form.append("mode", "preview");
  form.append("templateId", "keyword_gap_v1");
  form.append("file", file);

  const response = await fetch(
    `${API_BASE}/projects/${projectId}/sources/csv/import`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { Accept: "application/json" },
      body: form,
    },
  );

  const text = await response.text();
  let parsed: unknown = undefined;
  if (text.length > 0) {
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      parsed = undefined;
    }
  }
  if (!response.ok) throw new ApiError(toProblem(response, parsed));
  return (parsed as DataEnvelope<ImportPreviewData>).data;
}

export interface ImportCsvHook {
  readonly preview: UseMutationResult<ImportPreviewData, ApiError, File>;
  readonly confirm: UseMutationResult<
    AsyncAcceptedData,
    ApiError,
    ImportConfirmVariables
  >;
}

/**
 * Keyword-gap CSV import as two steps. `preview` uploads the file and returns the
 * first rows, detected columns, and a short-lived `importToken` (no canonical
 * write). `confirm` submits the token + final mapping with a fresh
 * `Idempotency-Key` and returns the accepted run; Sources is invalidated.
 */
export function useImportCsv(projectId: string): ImportCsvHook {
  const queryClient = useQueryClient();

  const preview = useMutation<ImportPreviewData, ApiError, File>({
    mutationFn: (file: File) => importCsvPreview(projectId, file),
  });

  const confirm = useMutation<
    AsyncAcceptedData,
    ApiError,
    ImportConfirmVariables
  >({
    mutationFn: async (vars: ImportConfirmVariables) => {
      const res = await apiSend<DataEnvelope<AsyncAcceptedData>>(
        "POST",
        `/projects/${projectId}/sources/csv/import`,
        {
          body: {
            mode: "confirm",
            importToken: vars.importToken,
            mapping: vars.mapping,
          },
          idempotencyKey: crypto.randomUUID(),
        },
      );
      return res.data;
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: sourcesKey(projectId) }),
  });

  return { preview, confirm };
}

/**
 * Disconnect a source and drop its credential; historical snapshots are kept
 * (spec §12). Both Sources and the snapshot list are invalidated.
 */
export function useDisconnectSource(
  projectId: string,
): UseMutationResult<void, ApiError, string> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (sourceConnectionId: string) =>
      apiSend<void>(
        "DELETE",
        `/projects/${projectId}/sources/${sourceConnectionId}`,
      ),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: sourcesKey(projectId) }),
        queryClient.invalidateQueries({ queryKey: snapshotsKey(projectId) }),
      ]);
    },
  });
}
