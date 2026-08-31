export const CITABILITY_RENDER_SCHEMA = "marketing-citability-render.v1" as const;
export const CITABILITY_RENDER_TIMEOUT_MS = 12_000;
export const CITABILITY_RENDER_MAX_REQUESTS = 40;
export const CITABILITY_RENDER_MAX_BYTES = 2_000_000;
export const CITABILITY_RENDER_RESOURCE_BYTES = 512_000;
export const CITABILITY_RENDER_TEXT_CHARS = 100_000;
/** Artifact T2 threshold: raw body carries at least 30% of rendered copy. */
export const CITABILITY_RAW_RENDER_RATIO_FLOOR = 0.3;

export type CitabilityRenderReason = "not_configured" | "timeout" | "service_failed" | "invalid_response" | "blocked" | "resource_limit" | "truncated" | "navigation";
export interface CitabilityRenderRequest {
  readonly url: string;
  /** Only the handler's safe-fetch result; never accepted from the public POST. */
  readonly rawHtml: string;
  readonly bodyComplete: boolean;
}
export interface CitabilityTextCapture {
  readonly method: "html_projection" | "browser_visible_text";
  readonly text: string;
  readonly textChars: number;
  readonly complete: boolean;
}
export interface CitabilityRenderEvidence {
  readonly schemaVersion: typeof CITABILITY_RENDER_SCHEMA;
  readonly status: "measured" | "partial" | "unavailable";
  readonly reason: CitabilityRenderReason | null;
  readonly finalUrl: string;
  readonly rawSha256: string;
  readonly raw: CitabilityTextCapture;
  readonly rendered: CitabilityTextCapture | null;
  readonly rawToRenderedRatio: number | null;
  readonly measuredAt: string;
  readonly requestCount: number;
  readonly blockedRequests: number;
  readonly omittedRequests: number;
  readonly bytes: number;
}
