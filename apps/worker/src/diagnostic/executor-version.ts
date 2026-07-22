import type { DiagnosticRunRow } from "@sf/db";
import { PROMPT_SET_VERSION, RULE_SET_VERSION } from "@sf/engine";

export const DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED =
  "DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED";
export const DIAGNOSTIC_EXECUTOR_VERSION_UNSUPPORTED_SUMMARY =
  "The frozen diagnostic executor version is unsupported.";

export function supportsCurrentDiagnosticExecutor(
  diagnostic: Pick<
    DiagnosticRunRow,
    "rule_set_version" | "prompt_set_version"
  >,
): boolean {
  return (
    diagnostic.rule_set_version === RULE_SET_VERSION &&
    diagnostic.prompt_set_version === PROMPT_SET_VERSION
  );
}
