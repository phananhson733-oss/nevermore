import { randomUUID } from "node:crypto";
import { waitForHook } from "@workflow/vitest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { resumeHook, start } from "workflow/api";

import { keywordOpportunityWorkflow } from "../src/lib/tools/keyword-opportunity-workflow.ts";
import { duplicateProbeWorkflow } from "../src/lib/tools/keyword-workflow-probe.ts";
import { readKeywordWorkflowRun } from "../src/lib/tools/keyword-workflow-handler.ts";

const previousSecret = process.env.MARKETING_COOKIE_SECRET;

beforeAll(() => {
  process.env.MARKETING_COOKIE_SECRET = Buffer.alloc(32, 29).toString(
    "base64",
  );
});

afterAll(() => {
  if (previousSecret === undefined) {
    delete process.env.MARKETING_COOKIE_SECRET;
  } else {
    process.env.MARKETING_COOKIE_SECRET = previousSecret;
  }
});

describe("keyword opportunity Workflow integration", () => {
  it("compiles the production workflow and returns a typed refusal before paid work", async () => {
    const run = await start(keywordOpportunityWorkflow, [
      {
        inputToken: "malformed",
        grantToken: "malformed",
        dedupeKey: "a".repeat(64),
      },
    ]);

    await expect(run.returnValue).resolves.toEqual({
      kind: "failed",
      code: "context_token_invalid",
    });
    await expect(run.status).resolves.toBe("completed");
    await expect(readKeywordWorkflowRun(run.runId)).resolves.toEqual({
      kind: "typed_failure",
      code: "context_token_invalid",
    });
  });

  it("uses an active deterministic hook to redirect a duplicate before effects", async () => {
    const suffix = randomUUID();
    const first = await start(duplicateProbeWorkflow, [
      {
        dedupeToken: `keyword-test:${suffix}`,
        holdToken: `keyword-hold:${suffix}`,
      },
    ]);
    await waitForHook(first, { token: `keyword-hold:${suffix}` });

    const duplicate = await start(duplicateProbeWorkflow, [
      {
        dedupeToken: `keyword-test:${suffix}`,
        holdToken: `keyword-unused:${suffix}`,
      },
    ]);

    await expect(duplicate.returnValue).resolves.toEqual({
      status: "redirect",
      ownerRunId: first.runId,
    });
    await resumeHook(`keyword-hold:${suffix}`, null);
    await expect(first.returnValue).resolves.toEqual({ status: "completed" });
  });
});
