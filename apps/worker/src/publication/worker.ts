import type { WorkerContext } from "../context.ts";
import {
  runPublication,
  type PublicationJobPayload,
  type PublicationProviderRuntime,
} from "./run-publication.ts";
import { createDbPublicationAuthority } from "./db-authority.ts";

export interface PublicationWorkerRunner {
  (ctx: WorkerContext, payload: PublicationJobPayload): Promise<void>;
}

/**
 * Hosted runtime is deliberately unavailable until the process receives both a
 * socket-pinned transport and a provider-specific credential issuer. There is
 * no global fetch or plaintext-credential fallback.
 */
export async function runPublicationJob(
  ctx: WorkerContext,
  payload: PublicationJobPayload,
  runtime: PublicationProviderRuntime = {},
): Promise<void> {
  const executionNow = new Date();
  const clock = () => executionNow;
  await runPublication(payload, {
    authority: createDbPublicationAuthority(ctx, clock),
    runtime,
    now: clock,
  });
}
