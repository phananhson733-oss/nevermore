export type RuntimeFailureType = "internal" | "unknown";
export type RuntimeFailureCode =
  | "UNAVAILABLE"
  | "WORKER_BOOT_FAILED"
  | "PGBOSS_RUNTIME_ERROR"
  | "PGBOSS_STOP_FAILED"
  | "READINESS_LEASE_RELEASE_FAILED";

function classifyFailure(error: unknown): RuntimeFailureType {
  try {
    return error instanceof Error ? "internal" : "unknown";
  } catch {
    // `instanceof` can invoke a Proxy getPrototypeOf trap. A process/error
    // boundary must remain total even for an adversarial thrown value.
    return "unknown";
  }
}

/**
 * Reduce an arbitrary thrown value to a stable, non-content-bearing shape.
 * Never read `message`, `name`, `stack`, or coerce the value to a string: all
 * of those can contain customer data or attacker-controlled text.
 */
export function runtimeFailureMetadata<const Code extends RuntimeFailureCode>(
  code: Code,
  error: unknown,
): Readonly<{ code: Code; type: RuntimeFailureType }> {
  return {
    code,
    type: classifyFailure(error),
  };
}

/**
 * Serialize the process-level boot failure without inspecting the thrown value.
 * Keeping this at the process boundary prevents `Error.message`, `toString`, or
 * other attacker-controlled content from reaching stdout/stderr.
 */
export function serializeWorkerBootFailure(error: unknown): string {
  return JSON.stringify({
    event: "worker_boot_failed",
    ...runtimeFailureMetadata("WORKER_BOOT_FAILED", error),
  });
}
