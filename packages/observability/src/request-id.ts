import { randomUUID } from "node:crypto";

/** Header carrying the per-request correlation id (spec §11.1). */
export const REQUEST_ID_HEADER = "x-request-id";

/** Printable-ASCII bound consistent with Idempotency-Key hygiene. */
const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,128}$/;

/** Generate a fresh request id. */
export function newRequestId(): string {
  return randomUUID();
}

/**
 * Trust an inbound request id only if it is well-formed; otherwise mint a new
 * one so callers cannot inject log-forging or oversized correlation ids.
 */
export function normalizeRequestId(inbound: string | null | undefined): string {
  if (inbound && REQUEST_ID_PATTERN.test(inbound)) return inbound;
  return newRequestId();
}
