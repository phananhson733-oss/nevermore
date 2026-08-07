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

const BACK_PROBE_PARAM = "e2eBackProbe";
const BACK_EVENT_STORAGE_KEY = "sf:e2e:back-observed";

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
  const view = card.locator(":scope > button");
  await expect(view).toHaveAccessibleName("View");
  await view.click();
  // The selected treatment is the card's only stable selection signal (the
  // button label does not change), and dev-mode CSS-module names keep the
  // authored class readable.
  await expect(card).toHaveClass(/artCardSelected/);
  await expect
    .poll(() => new URL(page.url()).searchParams.get("artifactId"))
    .toBe(artifactId);
}

/**
 * Build a deterministic same-document history pair without depending on
 * Execution's target-less default, which is intentionally canonicalized.
 */
async function stageBackTraversal(page: Page): Promise<void> {
  await page.evaluate((probeParam) => {
    const previous = new URL(window.location.href);
    previous.searchParams.set(probeParam, "previous");
    window.history.replaceState(window.history.state, "", previous);

    const current = new URL(previous);
    current.searchParams.set(probeParam, "current");
    window.history.pushState(window.history.state, "", current);
  }, BACK_PROBE_PARAM);
  await expect
    .poll(() => new URL(page.url()).searchParams.get(BACK_PROBE_PARAM))
    .toBe("current");
}

/**
 * Prove both that `popstate` fired and that the browser settled on the exact
 * previous history target. The sessionStorage marker keeps the wait bounded by
 * Playwright's 10-second assertion timeout if no event arrives.
 */
async function traverseBackAndExpectPrevious(page: Page): Promise<void> {
  await page.evaluate((eventStorageKey) => {
    window.sessionStorage.removeItem(eventStorageKey);
    window.addEventListener(
      "popstate",
      () => window.sessionStorage.setItem(eventStorageKey, "observed"),
      { once: true },
    );
    window.history.back();
  }, BACK_EVENT_STORAGE_KEY);
  await expect
    .poll(() =>
      page.evaluate(
        (eventStorageKey) => window.sessionStorage.getItem(eventStorageKey),
        BACK_EVENT_STORAGE_KEY,
      ),
    )
    .toBe("observed");
  await expect
    .poll(() => new URL(page.url()).searchParams.get(BACK_PROBE_PARAM))
    .toBe("previous");
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

/** Let every PATCH parked behind `holdPatch` complete. */
function releaseHeldPatches(state: ActionOverrideApiState): void {
  state.holdPatch = false;
  for (const release of state.heldPatchReleases.splice(0)) release();
}

function evidenceRail(page: Page): Locator {
  return page.locator("[data-studio-evidence-rail]");
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

test("a dirty artifact draft disables the adjust trigger until the draft is resolved", async ({
  page,
}) => {
  const { actions, artifacts } = sixStatusFixture();
  await installActionOverrideApi(page, { actions, artifacts });
  await openExecution(page);
  await selectArtifact(page, artifacts[1]!.id);
  const trigger = overrideTrigger(page);
  await expect(trigger).toBeEnabled();

  // An unsaved artifact draft closes the second editing entry point: two
  // independently dirty editors would chain two Back confirms, and the first
  // confirm would discard silently when the second is refused.
  const note = page.getByRole("textbox", { name: "Revision note" });
  await note.fill("unsaved draft note");
  await expect(trigger).toBeDisabled();
  await expect(trigger).toHaveAttribute(
    "aria-describedby",
    "sf-action-override-editor-hint",
  );
  await expect(page.locator("#sf-action-override-editor-hint")).toHaveText(
    "Save or discard the draft edits before adjusting the action.",
  );

  // Resolving the draft restores the trigger, and it opens.
  await note.fill("");
  await expect(trigger).toBeEnabled();
  await expect(page.locator("#sf-action-override-editor-hint")).toHaveCount(0);
  const dialog = await openOverrideDialog(page);
  await expect(dialog).toBeVisible();
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

test("no exit is offered while the PATCH is in flight", async ({ page }) => {
  const { actions, artifacts } = sixStatusFixture();
  const state = await installActionOverrideApi(page, { actions, artifacts });
  await openExecution(page);
  await selectArtifact(page, artifacts[1]!.id);
  const dialog = await openOverrideDialog(page);

  await statusSelect(dialog).selectOption("blocked");
  await reasonBox(dialog).fill("request in flight");
  state.holdPatch = true;
  await applyButton(dialog).click();
  await expectPatchCount(state, 1);
  await expect(applyButton(dialog)).toHaveText("Applying…");
  await expect(applyButton(dialog)).toBeDisabled();

  // Escape must not put up a discard confirm: the request already left, so
  // "Discard" would promise something the server may contradict.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await expect(page.locator("[data-action-override-discard]")).toHaveCount(0);
  await expect(dialog).toBeVisible();

  // The X is disabled outright, and a backdrop click is ignored.
  await expect(dialog.getByRole("button", { name: "Close" })).toBeDisabled();
  await page
    .locator("[data-action-override-backdrop]")
    .click({ position: { x: 8, y: 8 } });
  await page.waitForTimeout(200);
  await expect(page.locator("[data-action-override-discard]")).toHaveCount(0);
  await expect(dialog).toBeVisible();

  // Releasing the parked response resumes the normal success path.
  releaseHeldPatches(state);
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("[data-action-status-badge]")).toHaveText(
    "Blocked",
  );
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

// -------------------------------------------------- navigation guard (D3) --

test("browser Back asks before discarding a dirty override dialog", async ({
  page,
}) => {
  const { actions, artifacts } = sixStatusFixture();
  const state = await installActionOverrideApi(page, { actions, artifacts });
  await openExecution(page);
  await selectArtifact(page, artifacts[1]!.id);
  // A deterministic same-document history pair stands in for the shell
  // navigation that would normally precede Execution. `page.goBack()` cannot
  // be used because a refused traversal is undone by the guard and leaves
  // Playwright nothing to wait on.
  await stageBackTraversal(page);
  const dialog = await openOverrideDialog(page);
  await statusSelect(dialog).selectOption("blocked");
  await reasonBox(dialog).fill("guard me");

  const prompts: string[] = [];
  let answer = false;
  page.on("dialog", (browserDialog) => {
    prompts.push(browserDialog.message());
    void (answer ? browserDialog.accept() : browserDialog.dismiss());
  });

  // Refused: the traversal is undone, the dialog and every field survive.
  await page.evaluate(() => {
    window.history.back();
  });
  await expect(dialog).toBeVisible();
  await expect(reasonBox(dialog)).toHaveValue("guard me");
  await expect(statusSelect(dialog)).toHaveValue("blocked");
  await expect.poll(() => prompts.length).toBe(1);
  expect(prompts[0]).toBe(
    "You have unsaved action adjustments. Leave and discard them?",
  );
  await expect
    .poll(() => new URL(page.url()).searchParams.get(BACK_PROBE_PARAM))
    .toBe("current");
  await expectNoNewPatch(page, state, 0);

  // Confirmed: the dialog closes and the traversal completes.
  answer = true;
  await traverseBackAndExpectPrevious(page);
  await expect(dialog).not.toBeVisible();
  expect(prompts).toHaveLength(2);
});

test("a clean dialog neither prompts nor blocks a history traversal, and leaks no state after it", async ({
  page,
}) => {
  const { actions, artifacts } = sixStatusFixture();
  const state = await installActionOverrideApi(page, { actions, artifacts });
  await openExecution(page);
  await selectArtifact(page, artifacts[1]!.id);
  await stageBackTraversal(page);
  const dialog = await openOverrideDialog(page);

  const prompts: string[] = [];
  page.on("dialog", (browserDialog) => {
    prompts.push(browserDialog.message());
    void browserDialog.dismiss();
  });

  // A clean dialog holds no work, so the guard is unarmed: the traversal
  // completes at the browser level and no confirm is raised.
  //
  // Observe the browser event and the stable previous-entry probe instead of
  // sampling a short-lived target-less URL during canonicalization.
  await traverseBackAndExpectPrevious(page);
  await page.waitForTimeout(300);
  expect(prompts).toEqual([]);

  // Whatever the racy restore did to the page, a clean dialog must close on
  // Escape without a prompt, and the next dialog must start from ITS action
  // with a pristine form — no state may have crossed the traversal.
  if (await overrideDialog(page).isVisible()) {
    await page.keyboard.press("Escape");
  }
  await expect(dialog).not.toBeVisible();
  expect(prompts).toEqual([]);
  await selectArtifact(page, artifacts[4]!.id);
  const dialogB = await openOverrideDialog(page);
  await expect(reasonBox(dialogB)).toHaveValue("");
  await expect(statusSelect(dialogB)).toHaveValue("");
  await expect(statusSelect(dialogB).locator('option[value=""]')).toHaveText(
    "Keep current — Done",
  );
  await expectNoNewPatch(page, state, 0);
});

test("a clean override allows real browser Back to the previous project module", async ({
  page,
}) => {
  const { actions, artifacts } = sixStatusFixture();
  const state = await installActionOverrideApi(page, { actions, artifacts });
  await useEnglishUi(page);

  // Build the history through the actual customer shell rather than
  // manufacturing an Execution entry: Results -> Execution -> selected
  // artifact is the production navigation shape this guard must not block.
  await page.goto(`/p/${E2E_PROJECT_ID}/results`);
  await page.getByRole("link", { name: "Execution", exact: true }).click();
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe(`/p/${E2E_PROJECT_ID}/execution`);
  await selectArtifact(page, artifacts[1]!.id);
  const dialog = await openOverrideDialog(page);

  const prompts: string[] = [];
  page.on("dialog", (browserDialog) => {
    prompts.push(browserDialog.message());
    void browserDialog.dismiss();
  });

  await page.goBack();
  await expect
    .poll(() => new URL(page.url()).pathname)
    .toBe(`/p/${E2E_PROJECT_ID}/results`);
  await expect(dialog).not.toBeVisible();
  expect(prompts).toEqual([]);
  await expectNoNewPatch(page, state, 0);
});

// ------------------------------------------------------------- 409 space ---

test("a background refetch while editing cannot silently rebase the submission", async ({
  page,
}) => {
  const { actions, artifacts } = sixStatusFixture();
  const state = await installActionOverrideApi(page, { actions, artifacts });
  // Fake clock so the actions query can be pushed past the QueryClient's
  // 30s staleTime without waiting it out: reconnect refetches skip fresh
  // queries.
  await page.clock.install();
  await openExecution(page);
  await selectArtifact(page, artifacts[1]!.id);
  const dialog = await openOverrideDialog(page);
  await statusSelect(dialog).selectOption("blocked");
  await reasonBox(dialog).fill("frozen baseline");

  // A concurrent operator moves the action to R2 while the dialog is open...
  const current = state.currentActions.find(
    (item) => item.id === actions[1]!.id,
  )!;
  current.status = "in_progress";
  current.revision += 1;
  // ...and a reconnect-style background refetch brings R2 into the list
  // cache (refetchOnReconnect is the QueryClient default).
  const getsBefore = state.actionGetRequests.length;
  await page.clock.fastForward(31_000);
  await page.evaluate(async () => {
    window.dispatchEvent(new Event("offline"));
    await new Promise((resolve) => setTimeout(resolve, 80));
    window.dispatchEvent(new Event("online"));
  });
  await expect
    .poll(() => state.actionGetRequests.length, { timeout: 10_000 })
    .toBeGreaterThan(getsBefore);
  // The refreshed list reached the UI (the rail badge behind the modal now
  // shows the external change)...
  await expect(page.locator("[data-action-status-badge]")).toHaveText(
    "In progress",
  );
  // ...but the dialog still measures against the frozen open-time baseline.
  await expect(statusSelect(dialog).locator('option[value=""]')).toHaveText(
    "Keep current — Planned",
  );

  // The submission carries the OLD baseRevision and takes the honest 409,
  // instead of adopting R2 and stepping over the concurrent change.
  await applyButton(dialog).click();
  await expectPatchCount(state, 1);
  expect(state.actionPatchRequests[0]).toEqual({
    actionId: actions[1]!.id,
    body: { baseRevision: 1, reason: "frozen baseline", status: "blocked" },
  });
  await expect(
    dialog.getByText(
      "This action was changed elsewhere. The queue has been refreshed — review the current values and try again.",
    ),
  ).toBeVisible();
  // Only NOW does the baseline advance: keep label on the refreshed current,
  // the now-illegal "blocked" pick cleared, the reason kept.
  await expect(statusSelect(dialog).locator('option[value=""]')).toHaveText(
    "Keep current — In progress",
  );
  await expect(statusSelect(dialog)).toHaveValue("");
  await expect(reasonBox(dialog)).toHaveValue("frozen baseline");

  // Recovery resubmits against the adopted revision.
  await statusSelect(dialog).selectOption("done");
  await applyButton(dialog).click();
  await expectPatchCount(state, 2);
  expect(state.actionPatchRequests[1]).toEqual({
    actionId: actions[1]!.id,
    body: { baseRevision: 2, reason: "frozen baseline", status: "done" },
  });
  await expect(dialog).not.toBeVisible();
  await expect(page.locator("[data-action-status-badge]")).toHaveText("Done");
});

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

  // Provenance: the notice says the REFRESH failed, so the code beside it
  // must come from the failed GET (500 INTERNAL), not the earlier PATCH 409.
  const failureNotice = dialog.getByRole("alert");
  await expect(failureNotice).toContainText("INTERNAL");
  await expect(failureNotice).not.toContainText("VERSION_CONFLICT");

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

// ------------------------------------------- cross-page reachability (D8) --

test("a linked action on a later cursor page is auto-paginated into reach", async ({
  page,
}) => {
  // Three single-status actions across two pages (pageSize 2); the only
  // artifact points at the page-2 action.
  const actions = [1, 2, 3].map((n) =>
    overrideActionFixture(n, { title: `Cross page action ${n}` }),
  );
  const artifacts = [overrideArtifactFixture(1, actions[2]!.id)];
  const state = await installActionOverrideApi(page, {
    actions,
    artifacts,
    actionsPageSize: 2,
  });
  await openExecution(page);

  // The single artifact auto-selects; its action arrives via auto-pagination
  // without any operator gesture.
  await expect(page.locator("[data-studio-adjust-action]")).toBeVisible();
  await expect(
    evidenceRail(page).getByRole("heading", {
      name: "Cross page action 3",
      level: 3,
    }),
  ).toBeVisible();
  // Each cursor exactly once: the initial page, then the one follow-up page
  // the walk needed. A loop or a duplicate fetch fails this exact sequence.
  expect(state.actionGetRequests.map((request) => request.cursor)).toEqual([
    null,
    "actions-page-1",
  ]);

  // The dialog is fully armed against the cross-page action.
  const dialog = await openOverrideDialog(page);
  await expect(statusSelect(dialog).locator('option[value=""]')).toHaveText(
    "Keep current — Planned",
  );
  await statusSelect(dialog).selectOption("blocked");
  await reasonBox(dialog).fill("cross page override");
  await applyButton(dialog).click();
  await expectPatchCount(state, 1);
  expect(state.actionPatchRequests[0]).toEqual({
    actionId: actions[2]!.id,
    body: { baseRevision: 1, reason: "cross page override", status: "blocked" },
  });
});

test("a failed linked-action page read shows retry, and retry recovers the entry", async ({
  page,
}) => {
  const actions = [1, 2, 3].map((n) =>
    overrideActionFixture(n, { title: `Cross page action ${n}` }),
  );
  const artifacts = [overrideArtifactFixture(1, actions[2]!.id)];
  const state = await installActionOverrideApi(page, {
    actions,
    artifacts,
    actionsPageSize: 2,
  });
  state.failActionsPage = true;
  await openExecution(page);

  const rail = evidenceRail(page);
  await expect(rail.locator("[data-linked-action-error]")).toBeVisible();
  await expect(rail.locator("[data-linked-action-error]")).toHaveText(
    "We couldn't load the next page. Items already loaded are still shown.",
  );
  // The heading names the failure — it must not claim to be "still loading"
  // while the walk is actually parked behind the retry.
  await expect(
    rail.getByRole("heading", { name: "Linked action could not be loaded" }),
  ).toBeVisible();
  await expect(rail.getByText("Linked action is still loading")).toHaveCount(0);
  await expect(page.locator("[data-studio-adjust-action]")).not.toBeVisible();

  // The failed page read is retried exactly once by the QueryClient and then
  // parks: the walk must not keep re-requesting the failed cursor on its own.
  await expect
    .poll(() => state.actionGetRequests.length, { timeout: 10_000 })
    .toBe(3);
  await page.waitForTimeout(700);
  expect(state.actionGetRequests.map((request) => request.cursor)).toEqual([
    null,
    "actions-page-1",
    "actions-page-1",
  ]);

  state.failActionsPage = false;
  await rail.locator("[data-linked-action-retry]").click();
  await expect(page.locator("[data-studio-adjust-action]")).toBeVisible();
  await expect(
    evidenceRail(page).getByRole("heading", {
      name: "Cross page action 3",
      level: 3,
    }),
  ).toBeVisible();
  expect(state.actionGetRequests.map((request) => request.cursor)).toEqual([
    null,
    "actions-page-1",
    "actions-page-1",
    "actions-page-1",
  ]);
});

test("pages exhausted without the action reads as not-found, not loading", async ({
  page,
}) => {
  // One loaded page, no further pages, and an artifact whose action is
  // genuinely absent from the list.
  const actions = [overrideActionFixture(1)];
  const artifacts = [
    overrideArtifactFixture(1, "00000000-0000-4000-8000-000000000999"),
  ];
  await installActionOverrideApi(page, { actions, artifacts });
  await openExecution(page);

  const rail = evidenceRail(page);
  await expect(
    rail.getByRole("heading", {
      name: "Linked action was not found in the plan",
    }),
  ).toBeVisible();
  // The delivery-check binding row shares the same source of truth.
  await expect(
    rail.getByText("Linked action was not found in the plan"),
  ).toHaveCount(2);
  await expect(rail.getByText("Linked action is still loading")).toHaveCount(0);
  await expect(page.locator("[data-studio-adjust-action]")).toHaveCount(0);
});

test("the bounded page cap surfaces the search-limit state, not loading", async ({
  page,
}) => {
  // 101 single-action pages: the walk stops at the 100-page cap with pages
  // still remaining on the server, which is a statement about this screen's
  // search budget — not about the action's existence.
  test.setTimeout(120_000);
  const actions = Array.from({ length: 101 }, (_, index) =>
    overrideActionFixture(1, {
      id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
      title: `Sweep action ${index + 1}`,
    }),
  );
  const artifacts = [overrideArtifactFixture(1, actions[100]!.id)];
  const state = await installActionOverrideApi(page, {
    actions,
    artifacts,
    actionsPageSize: 1,
  });
  await openExecution(page);

  const rail = evidenceRail(page);
  await expect(
    rail.getByRole("heading", {
      name: "Linked action search stopped at the page limit",
    }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(rail.locator("[data-linked-action-search-limit]")).toHaveText(
    "The plan list is longer than the pages this screen can load. Open the Plan screen to locate this action.",
  );
  await expect(rail.getByText("Linked action is still loading")).toHaveCount(0);
  await expect(page.locator("[data-studio-adjust-action]")).toHaveCount(0);

  // Exactly the capped walk: the initial page plus 99 cursors, each once,
  // and no further fetch after the cap.
  const cursors = state.actionGetRequests.map((request) => request.cursor);
  expect(cursors).toEqual([
    null,
    ...Array.from({ length: 99 }, (_, index) => `actions-page-${index + 1}`),
  ]);
  await page.waitForTimeout(700);
  expect(state.actionGetRequests.length).toBe(cursors.length);
});

// -------------------------------------------------- coverage honesty (D9) --

test("a planned action without an artifact is ready to generate; a dismissed one stays absent", async ({
  page,
}) => {
  const withArtifact = overrideActionFixture(1, {
    title: "Editable with artifact",
  });
  const noArtifact = overrideActionFixture(2, {
    title: "Planned without artifact",
  });
  const dismissedNoArtifact = overrideActionFixture(3, {
    status: "dismissed",
    title: "Dismissed without artifact",
  });
  const artifacts = [overrideArtifactFixture(1, withArtifact.id)];
  await installActionOverrideApi(page, {
    actions: [withArtifact, noArtifact, dismissedNoArtifact],
    artifacts,
  });
  await openExecution(page);

  // The artifact-backed action remains the only canonical artifact row.
  await expect(
    page.locator("[data-studio-queue] [data-studio-artifact-id]"),
  ).toHaveCount(1);
  await expect(page.locator("[data-studio-adjust-action]")).toBeVisible();

  // A confirmed/planned action no longer disappears just because generation
  // has not happened yet: it is visible as a direct pending-generation card.
  const queue = page.locator("[data-studio-queue]");
  const pendingCard = queue.locator(
    `[data-studio-pending-action-id="${noArtifact.id}"]`,
  );
  await expect(pendingCard).toHaveCount(1);
  await expect(
    pendingCard.getByText("Planned without artifact", { exact: true }),
  ).toBeVisible();

  // It is also selectable from the canonical generation picker. A dismissed
  // artifact-less action remains absent from both surfaces.
  await page
    .getByRole("button", { name: "Configure a new deliverable" })
    .click();
  const picker = page.getByLabel("Pick an action");
  await expect(
    picker.getByText("Planned without artifact", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Dismissed without artifact")).toHaveCount(0);
});

// -------------------------------------- viewports, axe, evidence (D10) -----

const OVERRIDE_VIEWPORTS = [
  { label: "desktop", width: 1440, height: 900, evidence: true },
  { label: "rail-breakpoint", width: 1280, height: 800, evidence: false },
  { label: "mobile", width: 390, height: 844, evidence: true },
] as const;

async function expectNoDocumentOverflow(page: Page): Promise<void> {
  const overflow = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
}

async function expectNoComponentAxeViolations(
  page: Page,
  include: string,
): Promise<void> {
  const AxeBuilder = (await import("@axe-core/playwright")).default;
  const results = await new AxeBuilder({ page })
    .include(include)
    .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
    .analyze();
  const blocking = results.violations
    .filter((v) => v.impact === "critical" || v.impact === "serious")
    .map((v) => `${v.id} (${v.impact})`);
  expect(blocking, `axe violations inside ${include}`).toEqual([]);
}

for (const viewport of OVERRIDE_VIEWPORTS) {
  test(`the override dialog is fully operable at ${viewport.width}px`, async ({
    page,
  }, testInfo) => {
    const { actions, artifacts } = sixStatusFixture();
    const state = await installActionOverrideApi(page, { actions, artifacts });
    await page.setViewportSize({
      width: viewport.width,
      height: viewport.height,
    });
    await openExecution(page);
    await selectArtifact(page, artifacts[1]!.id);

    // Idle rail state: trigger present, no horizontal overflow, axe-clean.
    await expect(overrideTrigger(page)).toBeVisible();
    await expectNoDocumentOverflow(page);
    await expectNoComponentAxeViolations(page, "[data-studio-evidence-rail]");
    if (viewport.evidence) {
      await testInfo.attach(`override-rail-idle-${viewport.label}`, {
        body: await page.screenshot({ fullPage: false }),
        contentType: "image/png",
      });
    }

    // Dialog open: every control visible and focusable.
    const dialog = await openOverrideDialog(page);
    const controls = [
      statusSelect(dialog),
      prioritySelect(dialog),
      laneSelect(dialog),
      reasonBox(dialog),
      noteBox(dialog),
    ];
    for (const control of controls) {
      await control.scrollIntoViewIfNeeded();
      await expect(control).toBeVisible();
      await control.focus();
      await expect(control).toBeFocused();
    }
    await expect(applyButton(dialog)).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "Close" })).toBeVisible();
    await expectNoDocumentOverflow(page);
    await expectNoComponentAxeViolations(
      page,
      "[data-action-override-backdrop]",
    );
    if (viewport.evidence) {
      await testInfo.attach(`override-dialog-open-${viewport.label}`, {
        body: await page.screenshot({ fullPage: false }),
        contentType: "image/png",
      });
    }

    // And submittable: a real change round-trips at this viewport.
    await statusSelect(dialog).selectOption("blocked");
    await reasonBox(dialog).fill(`viewport ${viewport.label}`);
    await applyButton(dialog).click();
    await expectPatchCount(state, 1);
    await expect(dialog).not.toBeVisible();
    await expect(page.locator("[data-action-status-badge]")).toHaveText(
      "Blocked",
    );
  });
}
