import { ApiError } from "@/lib/api";

export interface ProblemSummary {
  readonly message: string;
  readonly code: string | null;
  readonly requestId: string | null;
}

function compactId(value: string): string | null {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function summarizeProblem(
  error: unknown,
  safeMessage: string,
): ProblemSummary {
  if (error instanceof ApiError) {
    return {
      message: safeMessage,
      code: error.code,
      requestId: compactId(error.problem.requestId),
    };
  }
  return {
    message: safeMessage,
    code: null,
    requestId: null,
  };
}
