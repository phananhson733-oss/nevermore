import { describe, expect, it } from "vitest";

import {
  actionExecutionStateEvents,
  actionExecutionStepDefinitions,
  schema,
} from "./schema.ts";

describe("Action Execution State query model", () => {
  it("exposes the two append-only authorities behind the existing Execution Center", () => {
    expect(schema.actionExecutionStepDefinitions).toBe(
      actionExecutionStepDefinitions,
    );
    expect(schema.actionExecutionStateEvents).toBe(
      actionExecutionStateEvents,
    );
    expect(actionExecutionStepDefinitions.definition_version.name).toBe(
      "definition_version",
    );
    expect(actionExecutionStepDefinitions.steps.name).toBe("steps");
    expect(actionExecutionStateEvents.unlock_condition.name).toBe(
      "unlock_condition",
    );
    expect(actionExecutionStateEvents.step_definition_id.name).toBe(
      "step_definition_id",
    );
    expect(actionExecutionStateEvents.completed_steps.name).toBe(
      "completed_steps",
    );
    expect(actionExecutionStateEvents.total_steps.name).toBe(
      "total_steps",
    );
    expect(actionExecutionStateEvents).not.toHaveProperty(
      "progress_percent",
    );
  });
});
