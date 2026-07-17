import {
  createLogger,
  normalizeRequestId,
  REQUEST_ID_HEADER,
  type Logger,
} from "@sf/observability";
import { getEnv } from "@/env";

/** Per-request correlation context threaded through handlers. */
export interface RequestContext {
  readonly requestId: string;
  readonly logger: Logger;
}

/** Build a request context from inbound headers, minting a request id if absent. */
export function buildRequestContext(headers: Headers): RequestContext {
  const requestId = normalizeRequestId(headers.get(REQUEST_ID_HEADER));
  const logger = createLogger({
    service: "web",
    environment: process.env["NODE_ENV"] ?? "development",
    requestId,
  });
  // Touch env lazily elsewhere; do not fail context construction on env.
  void getEnv;
  return { requestId, logger };
}
