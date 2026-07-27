export type PublishingProvider = "github" | "wordpress";

export type PublishingProviderErrorCode =
  | "AUTH_REVOKED"
  | "CANCELLED"
  | "DIRECT_PUBLISH_FORBIDDEN"
  | "INVALID_INPUT"
  | "INVALID_RESPONSE"
  | "LINEAGE_MISMATCH"
  | "LIVE_VERIFICATION_FAILED"
  | "PARTIAL_DELIVERY"
  | "PUBLISH_APPROVAL_REQUIRED"
  | "REDIRECT_BLOCKED"
  | "REMOTE_STALE"
  | "REMOTE_UNAVAILABLE"
  | "REQUEST_TOO_LARGE"
  | "RESPONSE_TOO_LARGE"
  | "SCOPE_DENIED"
  | "SCOPE_REVOKED"
  | "TIMEOUT"
  | "TOKEN_EXPIRED"
  | "TOKEN_LIFETIME_INVALID"
  | "UNSAFE_ENDPOINT";

export type SafeErrorDetailValue =
  | boolean
  | number
  | string
  | null
  | readonly boolean[]
  | readonly number[]
  | readonly string[];

export interface PublishingProviderErrorOptions {
  readonly code: PublishingProviderErrorCode;
  readonly provider: PublishingProvider;
  readonly operation: string;
  readonly message: string;
  readonly retryable?: boolean;
  readonly providerRequestId?: string | null;
  readonly remoteScopeRef?: string | null;
  readonly safeDetails?: Readonly<Record<string, SafeErrorDetailValue>> | null;
}

/**
 * Public, bounded provider failure.
 *
 * Raw provider bodies, transport causes, request headers, and credentials are
 * deliberately absent. API/worker callers may serialize this object without
 * leaking a provider secret or arbitrary vendor prose.
 */
export class PublishingProviderError extends Error {
  readonly code: PublishingProviderErrorCode;
  readonly provider: PublishingProvider;
  readonly operation: string;
  readonly retryable: boolean;
  readonly providerRequestId: string | null;
  readonly remoteScopeRef: string | null;
  readonly safeDetails: Readonly<Record<string, SafeErrorDetailValue>> | null;

  constructor(options: PublishingProviderErrorOptions) {
    super(options.message);
    this.name = "PublishingProviderError";
    this.code = options.code;
    this.provider = options.provider;
    this.operation = options.operation;
    this.retryable = options.retryable ?? false;
    this.providerRequestId = options.providerRequestId ?? null;
    this.remoteScopeRef = options.remoteScopeRef ?? null;
    this.safeDetails = options.safeDetails ?? null;
  }

  toJSON(): Readonly<Record<string, unknown>> {
    return {
      name: this.name,
      code: this.code,
      provider: this.provider,
      operation: this.operation,
      message: this.message,
      retryable: this.retryable,
      providerRequestId: this.providerRequestId,
      remoteScopeRef: this.remoteScopeRef,
      safeDetails: this.safeDetails,
    };
  }
}

export function isPublishingProviderError(
  value: unknown,
): value is PublishingProviderError {
  return value instanceof PublishingProviderError;
}
