import {
  LEGACY_RULE_SET_VERSION,
  PROMPT_SET_VERSION,
  RULE_SET_VERSION,
} from "@sf/engine";
import { describe, expect, it } from "vitest";
import {
  resolveDiagnosticExecutor,
  supportsDiagnosticExecutorVersion,
} from "./executor-version.ts";

function storedExecutor(
  ruleSetVersion: string,
  promptSetVersion: string = PROMPT_SET_VERSION,
) {
  return {
    rule_set_version: ruleSetVersion,
    prompt_set_version: promptSetVersion,
  };
}

describe("diagnostic executor version resolution", () => {
  it("resolves a genuine pre-governance 0.2.1 executor", () => {
    const executor = resolveDiagnosticExecutor(
      storedExecutor(LEGACY_RULE_SET_VERSION),
    );

    expect(executor).toMatchObject({
      ruleSetVersion: "mvp.rules.0.2.1",
      promptSetVersion: "mvp.prompts.0.2.0",
      governance: "forbidden",
    });
    expect(
      executor?.rules.find((rule) => rule.id === "CONTENT-GAP-011"),
    ).toMatchObject({ version: 1 });
    expect(
      supportsDiagnosticExecutorVersion(
        storedExecutor(LEGACY_RULE_SET_VERSION),
      ),
    ).toBe(true);
  });

  it("resolves the current 0.2.2 executor with mandatory governance", () => {
    const executor = resolveDiagnosticExecutor(
      storedExecutor(RULE_SET_VERSION),
    );

    expect(executor).toMatchObject({
      ruleSetVersion: "mvp.rules.0.2.2",
      promptSetVersion: "mvp.prompts.0.2.0",
      governance: "required",
    });
    expect(
      executor?.rules.find((rule) => rule.id === "CONTENT-GAP-011"),
    ).toMatchObject({ version: 2 });
  });

  it.each([
    ["unknown rule set", "mvp.rules.0.2.0", PROMPT_SET_VERSION],
    ["unknown prompt set", RULE_SET_VERSION, "mvp.prompts.0.1.0"],
    [
      "legacy rule with unknown prompt",
      LEGACY_RULE_SET_VERSION,
      "mvp.prompts.0.1.0",
    ],
  ])("fails closed for an %s", (_label, ruleSetVersion, promptSetVersion) => {
    const stored = storedExecutor(ruleSetVersion, promptSetVersion);

    expect(resolveDiagnosticExecutor(stored)).toBeNull();
    expect(supportsDiagnosticExecutorVersion(stored)).toBe(false);
  });
});
