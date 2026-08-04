import type { DiagnosticRunRow } from "@sf/db";
import {
  PROMPT_SET_VERSION,
  RULE_SET_VERSION,
  GOVERNED_LEGACY_RULE_SET_VERSION,
  rulesForRuleSetVersion,
  type DiagnosticRule,
} from "@sf/engine";

export const DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED =
  "DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED";
export const DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED_SUMMARY =
  "The frozen diagnostic executor version is unsupported.";

export interface DiagnosticExecutor {
  readonly ruleSetVersion: string;
  readonly promptSetVersion: string;
  readonly governance: "required" | "forbidden";
  readonly rules: readonly DiagnosticRule[];
}

type StoredDiagnosticExecutor = Pick<
  DiagnosticRunRow,
  "rule_set_version" | "prompt_set_version"
>;

export function resolveDiagnosticExecutor(
  diagnostic: StoredDiagnosticExecutor,
): DiagnosticExecutor | null {
  if (diagnostic.prompt_set_version !== PROMPT_SET_VERSION) return null;
  const rules = rulesForRuleSetVersion(diagnostic.rule_set_version);
  if (rules === null) return null;
  return {
    ruleSetVersion: diagnostic.rule_set_version,
    promptSetVersion: diagnostic.prompt_set_version,
    governance:
      diagnostic.rule_set_version === RULE_SET_VERSION ||
      diagnostic.rule_set_version === GOVERNED_LEGACY_RULE_SET_VERSION
        ? "required"
        : "forbidden",
    rules,
  };
}

export function supportsDiagnosticExecutorVersion(
  diagnostic: Pick<
    DiagnosticRunRow,
    "rule_set_version" | "prompt_set_version"
  >,
): boolean {
  return resolveDiagnosticExecutor(diagnostic) !== null;
}
