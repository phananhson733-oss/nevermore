export type PublicToolMode = "public_preview";
export type PublicToolPersistence = "none";
export type PublicToolCheckStatus =
  | "pass"
  | "warning"
  | "fail"
  | "unverified";
export type PublicToolSeverity = "critical" | "high" | "medium" | "low";
export type PublicToolEvidenceValue = string | number | boolean | null;

export interface PublicToolEvidence<TSource extends string = string> {
  readonly label: string;
  readonly value: PublicToolEvidenceValue;
  readonly source: TSource;
}

export interface PublicToolCheck<
  TModule extends string = string,
  TSource extends string = string,
> {
  readonly id: string;
  readonly module: TModule;
  readonly status: PublicToolCheckStatus;
  readonly severity: PublicToolSeverity;
  readonly weight: number;
  readonly evidence: readonly PublicToolEvidence<TSource>[];
  readonly limitation: string | null;
}

export interface PublicToolRun<
  TTool extends string = string,
  TScope extends string = string,
> {
  readonly tool: TTool;
  readonly schemaVersion: string;
  readonly mode: PublicToolMode;
  readonly scope: TScope;
  readonly persistence: PublicToolPersistence;
  readonly completedAt: string;
}

export interface PublicToolResultEnvelope<
  TResult,
  TTool extends string = string,
  TScope extends string = string,
> {
  readonly run: PublicToolRun<TTool, TScope>;
  readonly result: TResult;
}

export interface PublicToolErrorEnvelope<TCode extends string = string> {
  readonly error: {
    readonly code: TCode;
  };
}

export function createPublicToolResult<
  TResult,
  TTool extends string,
  TScope extends string,
>(
  run: Omit<PublicToolRun<TTool, TScope>, "mode" | "persistence">,
  result: TResult,
): PublicToolResultEnvelope<TResult, TTool, TScope> {
  return {
    run: {
      ...run,
      mode: "public_preview",
      persistence: "none",
    },
    result,
  };
}

export function createPublicToolError<TCode extends string>(
  code: TCode,
): PublicToolErrorEnvelope<TCode> {
  return { error: { code } };
}
