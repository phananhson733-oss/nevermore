// @input  -- deterministic tokens supplied only by the Workflow integration test
// @output -- a held owner or a redirect proving active-hook conflict semantics
// @pos    -- test-only Workflow primitive probe; never imported by production routes
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { createHook } from "workflow";

export async function duplicateProbeWorkflow(input: {
  readonly dedupeToken: string;
  readonly holdToken: string;
}) {
  "use workflow";
  using duplicate = createHook({ token: input.dedupeToken });
  const conflict = await duplicate.getConflict();
  if (conflict !== null) {
    return { status: "redirect" as const, ownerRunId: conflict.runId };
  }
  using hold = createHook({ token: input.holdToken });
  await hold;
  return { status: "completed" as const };
}
