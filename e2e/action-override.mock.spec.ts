import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  E2E_PROJECT_ID,
  installActionOverrideApi,
  overrideActionFixture,
  overrideArtifactFixture,
  type ActionOverrideApiState,
} from "./mock-api.ts";

/**
 * Execution (Studio) Action override dialog — R2 blueprint 2026-07-27 §4
 * acceptance matrix. The mock actions store is MUTABLE (D7): successful PATCH
 * responses advance revision and later GET /actions reads observe them, so
 * every assertion here can check UI state and the NEXT request's baseRevision
 * rather than merely counting requests.
 */

const STATUS_LABEL: Record<string, string> = {
  candidate: "Candidate",
  planned: "Planned",
  in_progress: "In progress",
  blocked: "Blocked",
  done: "Done",
  dismissed: "Dismissed",
};

/** Client/server frozen graph (parity-tested in _plan-status.test.ts). */
const ALLOWED_TARGETS: Record<string, readonly string[]> = {
  candidate: ["planned", "dismissed"],
  planned: ["in_progress", "blocked", "dismissed"],
  in_progress: ["done"],
  blocked: ["in_progress"],
  done: ["planned"],
  dismissed: ["planned"],
};

const SIX_STATUSES = [
  "candidate",
  "planned",
  "in_progress",
  "blocked",
  "done",
  "dismissed",
] as const;

function sixStatusFixture() {
  const actions = SIX_STATUSES.map((status, index) =>
    overrideActionFixture(index + 1, {
      status,
      title: `Override target ${status}`,
    }),
  );
  const artifacts = actions.map((action, index) =>
    overrideArtifactFixture(index + 1, action.id),
  );
  return { actions, artifacts };
}

async function useEnglishUi(page: Page): Promise<void> {
  await page
    .context()
    .addCookies([
      { name: "sf_ui_locale", value: "en", domain: "localhost", path: "/" },
    ]);
}

async function openExecution(page: Page): Promise<void> {
  await useEnglishUi(page);
  await page.goto(`/p/${E2E_PROJECT_ID}/execution`);
  await expect(page.locator("[data-studio-workspace]")).toBeVisible();
}

async function selectArtifact(page: Page, artifactId: string): Promise<void> {
  const card = page.locator(`[data-studio-artifact-id="${artifactId}"]`);
  await card.getByRole("button", { name: "Open" }).click();
  // The selected treatment is the card's only stable selection signal (the
  // button label does not change), and dev-mode CSS-module names keep the
  // authored class readable.
  await expect(card).toHaveClass(/artCardSelected/);
}

function overrideTrigger(page: Page): Locator {
  return page.locator("[data-studio-adjust-action]");
}

function overrideDialog(page: Page): Locator {
  return page.locator("[data-action-override-dialog]");
}

async function openOverrideDialog(page: Page): Promise<Locator> {
  await overrideTrigger(page).click();
  const dialog = overrideDialog(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

function statusSelect(dialog: Locator): Locator {
  return dialog.getByLabel("New status");
}

function prioritySelect(dialog: Locator): Locator {
  return dialog.getByLabel("New priority");
}

function laneSelect(dialog: Locator): Locator {
  return dialog.getByLabel("New window");
}

function reasonBox(dialog: Locator): Locator {
  return dialog.getByLabel("Reason", { exact: false }).first();
}

function noteBox(dialog: Locator): Locator {
  return dialog.getByLabel("Note", { exact: false }).first();
}

function applyButton(dialog: Locator): Locator {
  return dialog.getByRole("button", { name: /Apply override|Applying/ });
}

async function expectPatchCount(
  state: ActionOverrideApiState,
  count: number,
): Promise<void> {
  await expect
    .poll(() => state.actionPatchRequests.length, { timeout: 10_000 })
    .toBe(count);
}

/** Give a not-expected request every chance to arrive before asserting zero. */
async function expectNoNewPatch(
  page: Page,
  state: ActionOverrideApiState,
  countBefore: number,
): Promise<void> {
  await page.waitForTimeout(400);
  expect(state.actionPatchRequests.length).toBe(countBefore);
}

// --------------------------------------------------------------- entry -----

test("the rail exposes a status badge and a dialog trigger for the linked action", async ({
  page,
}) => {
  const { actions, artifacts } = sixStatusFixture();
  await installActionOverrideApi(page, { actions, artifacts });
  await openExecution(page);
  await selectArtifact(page, artifacts[1]!.id);

  const badge = page.locator("[data-action-status-badge]");
  await expect(badge).toHaveText("Planned");

  const trigger = overrideTrigger(page);
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
  await expect(trigger).toHaveAttribute("aria-expanded", "false");

  const dialog = await openOverrideDialog(page);
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveRole("dialog");
  // Focus starts inside the dialog and Escape (clean form) closes it,
  // returning focus to the trigger (product-profile modal contract).
  await expect
    .poll(() =>
      page.evaluate(() => {
        const dialogEl = document.querySelector(
          "[data-action-override-dialog]",
        );
        return dialogEl?.contains(document.activeElement) ?? false;
      }),
    )
    .toBe(true);
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(trigger).toBeFocused();
});

test("every action status offers exactly the allowed transitions plus the keep sentinel", async ({
  page,
}) => {
  const { actions, artifacts } = sixStatusFixture();
  await installActionOverrideApi(page, { actions, artifacts });
  await openExecution(page);

  for (const [index, status] of SIX_STATUSES.entries()) {
    await selectArtifact(page, artifacts[index]!.id);
    const dialog = await openOverrideDialog(page);
    const options = statusSelect(dialog).locator("option");
    const values = await options.evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLOptionElement).value),
    );
    expect(values, `status=${status}`).toEqual([
      "",
      ...ALLOWED_TARGETS[status]!,
    ]);
    await expect(options.first()).toHaveText(
      `Keep current — ${STATUS_LABEL[status]}`,
    );
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
  }
});

// ------------------------------------------------------------ PATCH body ---

test("status-only, priority-only, lane-only, and combined bodies carry only real changes", async ({
  page,
}) => {
  const { actions, artifacts } = sixStatusFixture();
  const state = await installActionOverrideApi(page, { actions, artifacts });
  await openExecution(page);

  // status-only on the planned action.
  await selectArtifact(page, artifacts[1]!.id);
  let dialog = await openOverrideDialog(page);
  await statusSelect(dialog).selectOption("blocked");
  await reasonBox(dialog).fill("status only");
  await applyButton(dialog).click();
  await expectPatchCount(state, 1);
  expect(state.actionPatchRequests[0]).toEqual({
    actionId: actions[1]!.id,
    body: { baseRevision: 1, reason: "status only", status: "blocked" },
  });
  await expect(dialog).not.toBeVisible();

  // priority-only on the candidate action (current priority is "high").
  await selectArtifact(page, artifacts[0]!.id);
  dialog = await openOverrideDialog(page);
  await prioritySelect(dialog).selectOption("low");
  await reasonBox(dialog).fill("priority only");
  await applyButton(dialog).click();
  await expectPatchCount(state, 2);
  expect(state.actionPatchRequests[1]).toEqual({
    actionId: actions[0]!.id,
    body: { baseRevision: 1, reason: "priority only", priorityBand: "low" },
  });
  await expect(dialog).not.toBeVisible();

  // lane-only on the in_progress action (current lane is "now").
  await selectArtifact(page, artifacts[2]!.id);
  dialog = await openOverrideDialog(page);
  await laneSelect(dialog).selectOption("later");
  await reasonBox(dialog).fill("lane only");
  await applyButton(dialog).click();
  await expectPatchCount(state, 3);
  expect(state.actionPatchRequests[2]).toEqual({
    actionId: actions[2]!.id,
    body: { baseRevision: 1, reason: "lane only", roadmapLane: "later" },
  });
  await expect(dialog).not.toBeVisible();

  // combined status+priority+lane+note on the blocked action.
  await selectArtifact(page, artifacts[3]!.id);
  dialog = await openOverrideDialog(page);
  await statusSelect(dialog).selectOption("in_progress");
  await prioritySelect(dialog).selectOption("critical");
  await laneSelect(dialog).selectOption("next");
  await reasonBox(dialog).fill("combined change");
  await noteBox(dialog).fill("note for the team");
  await applyButton(dialog).click();
  await expectPatchCount(state, 4);
  expect(state.actionPatchRequests[3]).toEqual({
    actionId: actions[3]!.id,
    body: {
      baseRevision: 1,
      reason: "combined change",
      status: "in_progress",
      priorityBand: "critical",
      roadmapLane: "next",
      note: "note for the team",
    },
  });
});

// ------------------------------------------------------- local validation --

test("a short reason is refused locally and never reaches the wire", async ({
  page,
}) => {
  const { actions, artifacts } = sixStatusFixture();
  const state = await installActionOverrideApi(page, { actions, artifacts });
  await openExecution(page);
  await selectArtifact(page, artifacts[1]!.id);
  const dialog = await openOverrideDialog(page);

  await statusSelect(dialog).selectOption("blocked");
  await reasonBox(dialog).fill("no");
  await applyButton(dialog).click();
  await expect(
    dialog.getByText("Enter a reason of at least 3 characters."),
  ).toBeVisible();
  await expectNoNewPatch(page, state, 0);

  // Three characters is the boundary-in case.
  await reasonBox(dialog).fill("yes");
  await applyButton(dialog).click();
  await expectPatchCount(state, 1);
  expect(state.actionPatchRequests[0]).toEqual({
    actionId: actions[1]!.id,
    body: { baseRevision: 1, reason: "yes", status: "blocked" },
  });
});

test("reason and note enforce the contract upper bounds at the control", async ({
  page,
}) => {
  const { actions, artifacts } = sixStatusFixture();
  const state = await installActionOverrideApi(page, { actions, artifacts });
  await openExecution(page);
  await selectArtifact(page, artifacts[1]!.id);
  const dialog = await openOverrideDialog(page);

  // The contract caps (reason 1000 / note 4000) are enforced by the control
  // itself; the 1001/4001 rejection paths are unit-tested in the view-model.
  await expect(reasonBox(dialog)).toHaveAttribute("maxlength", "1000");
  await expect(noteBox(dialog)).toHaveAttribute("maxlength", "4000");

  await statusSelect(dialog).selectOption("blocked");
  await reasonBox(dialog).fill("r".repeat(1001));
  await expect
    .poll(async () => (await reasonBox(dialog).inputValue()).length)
    .toBe(1000);
  await applyButton(dialog).click();
  await expectPatchCount(state, 1);
  const sent = state.actionPatchRequests[0] as {
    body: { reason: string };
  };
  expect(sent.body.reason).toBe("r".repeat(1000));
});

test("an all-kept form is a local noChange refusal, not a request", async ({
  page,
}) => {
  const { actions, artifacts } = sixStatusFixture();
  const state = await installActionOverrideApi(page, { actions, artifacts });
  await openExecution(page);
  await selectArtifact(page, artifacts[1]!.id);
  const dialog = await openOverrideDialog(page);

  await reasonBox(dialog).fill("valid reason");
  // Selecting the action's current priority is "kept", not a change.
  await prioritySelect(dialog).selectOption("high");
  await applyButton(dialog).click();
  await expect(
    dialog.getByText(
      "Choose a new status, priority, or window before applying.",
    ),
  ).toBeVisible();
  await expectNoNewPatch(page, state, 0);
});

test("a double-click on apply sends exactly one PATCH", async ({ page }) => {
  const { actions, artifacts } = sixStatusFixture();
  const state = await installActionOverrideApi(page, { actions, artifacts });
  await openExecution(page);
  await selectArtifact(page, artifacts[1]!.id);
  const dialog = await openOverrideDialog(page);

  await statusSelect(dialog).selectOption("blocked");
  await reasonBox(dialog).fill("double click race");
  await applyButton(dialog).dblclick();
  await expectPatchCount(state, 1);
  await expect(dialog).not.toBeVisible();
  await expectNoNewPatch(page, state, 1);
});

// ----------------------------------------------------------------- success --

test("success closes the dialog, updates the badge, and advances baseRevision", async ({
  page,
}) => {
  const { actions, artifacts } = sixStatusFixture();
  const state = await installActionOverrideApi(page, { actions, artifacts });
  await openExecution(page);
  await selectArtifact(page, artifacts[1]!.id);

  let dialog = await openOverrideDialog(page);
  await statusSelect(dialog).selectOption("blocked");
  await reasonBox(dialog).fill("first override");
  await applyButton(dialog).click();
  await expect(dialog).not.toBeVisible();
  await expectPatchCount(state, 1);

  // The rail badge reflects the successful response.
  await expect(page.locator("[data-action-status-badge]")).toHaveText(
    "Blocked",
  );

  // Reopening shows the new keep labels and submits the advanced revision.
  dialog = await openOverrideDialog(page);
  await expect(statusSelect(dialog).locator('option[value=""]')).toHaveText(
    "Keep current — Blocked",
  );
  await statusSelect(dialog).selectOption("in_progress");
  await reasonBox(dialog).fill("second override");
  await applyButton(dialog).click();
  await expectPatchCount(state, 2);
  expect(state.actionPatchRequests[1]).toEqual({
    actionId: actions[1]!.id,
    body: { baseRevision: 2, reason: "second override", status: "in_progress" },
  });
});

test("the badge shows the successful response even when the background refetch fails", async ({
  page,
}) => {
  const { actions, artifacts } = sixStatusFixture();
  const state = await installActionOverrideApi(page, { actions, artifacts });
  await openExecution(page);
  await selectArtifact(page, artifacts[1]!.id);

  const dialog = await openOverrideDialog(page);
  await statusSelect(dialog).selectOption("blocked");
  await reasonBox(dialog).fill("refetch will fail");
  state.failActionsGet = true;
  await applyButton(dialog).click();
  await expect(dialog).not.toBeVisible();
  await expectPatchCount(state, 1);

  // The invalidation refetch fails (initial + retry); the PATCH response is
  // still adopted into the cache by the guarded success write.
  await expect(page.locator("[data-action-status-badge]")).toHaveText(
    "Blocked",
  );
  const reopened = await openOverrideDialog(page);
  await expect(statusSelect(reopened).locator('option[value=""]')).toHaveText(
    "Keep current — Blocked",
  );
});

// --------------------------------------------------- dirty state / D3 ------

test("a dirty dialog demands a discard confirmation and never leaks values across actions", async ({
  page,
}) => {
  const { actions, artifacts } = sixStatusFixture();
  const state = await installActionOverrideApi(page, { actions, artifacts });
  await openExecution(page);

  // Dirty A, try to close, keep editing: values survive.
  await selectArtifact(page, artifacts[1]!.id);
  const dialog = await openOverrideDialog(page);
  await statusSelect(dialog).selectOption("blocked");
  await reasonBox(dialog).fill("reason for A");
  await page.keyboard.press("Escape");
  const confirm = page.locator("[data-action-override-discard]");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Keep editing" }).click();
  await expect(confirm).not.toBeVisible();
  await expect(dialog).toBeVisible();
  await expect(reasonBox(dialog)).toHaveValue("reason for A");
  await expect(statusSelect(dialog)).toHaveValue("blocked");

  // Close again and discard for real.
  await page.keyboard.press("Escape");
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "Discard" }).click();
  await expect(dialog).not.toBeVisible();

  // B opens clean: B's keep labels, empty text, and a B-only PATCH body.
  await selectArtifact(page, artifacts[4]!.id);
  const dialogB = await openOverrideDialog(page);
  await expect(reasonBox(dialogB)).toHaveValue("");
  await expect(statusSelect(dialogB)).toHaveValue("");
  await expect(statusSelect(dialogB).locator('option[value=""]')).toHaveText(
    "Keep current — Done",
  );
  await statusSelect(dialogB).selectOption("planned");
  await reasonBox(dialogB).fill("reason for B");
  await applyButton(dialogB).click();
  await expectPatchCount(state, 1);
  expect(state.actionPatchRequests[0]).toEqual({
    actionId: actions[4]!.id,
    body: { baseRevision: 1, reason: "reason for B", status: "planned" },
  });
});

// ------------------------------------------------------------- 409 space ---

test("a stale 409 refreshes the queue, keeps the reason, and clears now-illegal picks", async ({
  page,
}) => {
  const { actions, artifacts } = sixStatusFixture();
  const state = await installActionOverrideApi(page, { actions, artifacts });
  await openExecution(page);
  await selectArtifact(page, artifacts[1]!.id);

  const dialog = await openOverrideDialog(page);
  await statusSelect(dialog).selectOption("blocked");
  await reasonBox(dialog).fill("stale conflict path");
  // The stale toggle bumps the action elsewhere-style (status -> blocked,
  // revision + 1) BEFORE answering 409, so the refresh observes real change.
  state.conflictMode = "stale";
  await applyButton(dialog).click();
  await expectPatchCount(state, 1);

  const conflictText =
    "This action was changed elsewhere. The queue has been refreshed — review the current values and try again.";
  await expect(dialog.getByText(conflictText)).toBeVisible();
  // Announced exactly once: the ProblemNotice is the only conflict rendering.
  expect(await dialog.getByText(conflictText).count()).toBe(1);

  // Keep label adopted the refreshed current; the operator's text survives;
  // the "blocked" pick is illegal from blocked and so was cleared.
  await expect(statusSelect(dialog).locator('option[value=""]')).toHaveText(
    "Keep current — Blocked",
  );
  await expect(reasonBox(dialog)).toHaveValue("stale conflict path");
  await expect(statusSelect(dialog)).toHaveValue("");

  // Recovery: pick a legal target and resubmit against the bumped revision.
  state.conflictMode = "none";
  await statusSelect(dialog).selectOption("in_progress");
  await applyButton(dialog).click();
  await expectPatchCount(state, 2);
  expect(state.actionPatchRequests[1]).toEqual({
    actionId: actions[1]!.id,
    body: {
      baseRevision: 2,
      reason: "stale conflict path",
      status: "in_progress",
    },
  });
  await expect(dialog).not.toBeVisible();
});

test("an illegal-transition 409 clears the status pick and cannot loop", async ({
  page,
}) => {
  const { actions, artifacts } = sixStatusFixture();
  const state = await installActionOverrideApi(page, { actions, artifacts });
  await openExecution(page);
  await selectArtifact(page, artifacts[1]!.id);

  const dialog = await openOverrideDialog(page);
  await statusSelect(dialog).selectOption("blocked");
  await reasonBox(dialog).fill("illegal transition");
  state.conflictMode = "illegal";
  await applyButton(dialog).click();
  await expectPatchCount(state, 1);

  await expect(
    dialog.getByText(
      "That status change is not allowed from the action's current state. Pick a different status.",
    ),
  ).toBeVisible();
  await expect(statusSelect(dialog)).toHaveValue("");

  // Resubmitting without a new pick is a local noChange, not another 409.
  await applyButton(dialog).click();
  await expect(
    dialog.getByText(
      "Choose a new status, priority, or window before applying.",
    ),
  ).toBeVisible();
  await expectNoNewPatch(page, state, 1);

  // A different dimension still goes through once the operator re-chooses.
  state.conflictMode = "none";
  await prioritySelect(dialog).selectOption("low");
  await applyButton(dialog).click();
  await expectPatchCount(state, 2);
  expect(state.actionPatchRequests[1]).toEqual({
    actionId: actions[1]!.id,
    body: {
      baseRevision: 1,
      reason: "illegal transition",
      priorityBand: "low",
    },
  });
});

test("a failed conflict refresh locks the form behind retry, and retry recovers", async ({
  page,
}) => {
  const { actions, artifacts } = sixStatusFixture();
  const state = await installActionOverrideApi(page, { actions, artifacts });
  await openExecution(page);
  await selectArtifact(page, artifacts[1]!.id);

  const dialog = await openOverrideDialog(page);
  await statusSelect(dialog).selectOption("blocked");
  await reasonBox(dialog).fill("refresh will fail");
  state.conflictMode = "stale";
  state.failActionsGet = true;
  await applyButton(dialog).click();
  await expectPatchCount(state, 1);

  await expect(
    dialog.getByText(
      "The action changed elsewhere and refreshing it failed. Retry to load the current values.",
    ),
  ).toBeVisible();
  await expect(applyButton(dialog)).toBeDisabled();

  // Clear the injected failure; Retry now succeeds and lands on
  // staleConflict against the bumped revision.
  state.conflictMode = "none";
  state.failActionsGet = false;
  await dialog.getByRole("button", { name: "Retry" }).click();
  await expect(
    dialog.getByText(
      "This action was changed elsewhere. The queue has been refreshed — review the current values and try again.",
    ),
  ).toBeVisible();
  await expect(applyButton(dialog)).toBeEnabled();
  await expect(reasonBox(dialog)).toHaveValue("refresh will fail");
});
