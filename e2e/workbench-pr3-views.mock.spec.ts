import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import {
  gscExport,
  loadSample,
  openView,
  prepareEnglishPage,
  readStored,
  writeStored,
} from "./workbench-e2e.ts";

/**
 * Behaviour of the PR-3 views that only a real browser shows: a second tab's
 * storage event, two clicks in one task, a download's bytes, and a clock read
 * after hydration. Each test names the handoff it verifies; jsdom already pins
 * the rest of each view.
 */

test.beforeEach(async ({ page }) => {
  await prepareEnglishPage(page);
});

/** A second tab of the same browser: same storage, its own mock API routes. */
async function secondTab(page: Page): Promise<Page> {
  const other = await page.context().newPage();
  await prepareEnglishPage(other);
  return other;
}

const STAMP = String.raw`\d{4}-\d{2}-\d{2} \d{2}:\d{2}`;

const OUTSIDE = "This check falls outside the date range above";
const RANGE_UNKNOWN =
  "It can't be confirmed whether this check falls within the date range above.";

/** Rewrites the stored latest audit's stamp (both `audit` and `lastAudit`). */
async function restampLatestAudit(page: Page, at: string): Promise<void> {
  const stored = await readStored(page);
  expect(
    stored?.state.lastAudit,
    "the sample stores a latest audit",
  ).toBeTruthy();
  if (stored === null || stored.state.lastAudit === null) return;
  const lastAudit = { ...stored.state.lastAudit, at };
  const audit =
    stored.state.audit === null ? null : { ...stored.state.audit, at };
  await writeStored(page, {
    ...stored,
    state: { ...stored.state, lastAudit, audit },
  });
}

test("week health card places its check against the page's dates (T8 1077d94a / b7e8b8ad)", async ({
  page,
}) => {
  await loadSample(page);
  await openView(page, "week");
  const health = page.locator('[data-wb-week-card="health"]');
  const at = health.locator('[data-wb-foot="at"]');

  // Inside: the sample's audit is stamped today. Neither range sentence exists.
  await expect(at).toHaveText(new RegExp(`^Checked ${STAMP}$`, "u"));
  await expect(health.locator('[data-wb-foot="outside"]')).toHaveCount(0);
  await expect(health.locator('[data-wb-foot="rangeUnknown"]')).toHaveCount(0);

  // Outside: a real stamp months before the seven local dates.
  await restampLatestAudit(page, "2026-01-01 09:05");
  await page.reload();
  await expect(at).toHaveText("Checked 2026-01-01 09:05");
  await expect(health.locator('[data-wb-foot="outside"]')).toHaveText(OUTSIDE);
  await expect(health.locator('[data-wb-foot="rangeUnknown"]')).toHaveCount(0);

  // Unknown: the schema's pattern accepts it, the calendar has no 30 February.
  await restampLatestAudit(page, "2026-02-30 09:05");
  await page.reload();
  await expect(at).toHaveText("Checked 2026-02-30 09:05");
  await expect(health.locator('[data-wb-foot="rangeUnknown"]')).toHaveText(
    RANGE_UNKNOWN,
  );
  await expect(health.locator('[data-wb-foot="outside"]')).toHaveCount(0);
});

const STALE =
  "The data changed while this profile was being generated, so this result was not saved. You can generate it again.";

test("a profile run whose data changed in another tab writes nothing, and the next run's document lands (T9 3b859133)", async ({
  page,
}) => {
  await loadSample(page);
  // This tab is on the profile page before the other tab opens its box. With
  // the navigation after it instead, a probe found the other tab's document
  // replaced (its window globals gone) and the box closed; the cause was not
  // established, and this test is not about it.
  await openView(page, "profile");
  const other = await secondTab(page);
  await openView(other, "data-sources");
  await expect(other.locator("[data-wb-gsc-row]").first()).toBeVisible();
  await other.getByRole("button", { name: "Clear", exact: true }).click();
  const clearBox = other.getByRole("dialog", {
    name: "Clear the imported GSC rows?",
  });
  await expect(clearBox).toBeVisible();

  const title = page.locator("[data-wb-pane-head] h2").last();
  await expect(title).toHaveText(new RegExp(`^Site profile · ${STAMP}$`, "u"));
  const before = await title.textContent();
  // The refused run reads an input the stored document does not carry, so a
  // write that slipped through would change the bytes even if it kept the old
  // stamp: the same inputs rebuild the same body, which no comparison can see.
  const positioning = page.getByLabel("Positioning in one line");
  const refusedMarker = "e2e marker for the refused profile run";
  await positioning.fill(refusedMarker);
  // The persisted document as bytes. Only `profileDoc`: the other tab's clear
  // changes the rows, which is the point, so the rest of the store moves.
  const storedDoc = async (): Promise<string> =>
    JSON.stringify((await readStored(page))?.state.profileDoc ?? null);
  const docBefore = await storedDoc();
  expect(docBefore, "the sample stores a profile document").not.toBe("null");
  expect(docBefore, "the stored document predates the marker").not.toContain(refusedMarker);
  const run = page.getByRole("button", {
    name: "Regenerate the profile",
    exact: true,
  });
  const alert = page.locator('[role="alert"][data-wb-profile-stale]');

  // Three sources on: four 400 ms steps. The clear lands well inside them.
  await run.click();
  await expect(
    page.getByRole("button", { name: "Generating…", exact: true }),
  ).toBeDisabled();
  await clearBox.getByRole("button", { name: "Clear", exact: true }).click();
  await expect(other.locator("[data-wb-gsc-row]")).toHaveCount(0);

  await expect(alert).toHaveText(STALE);
  // Above the run button, inside the input pane.
  const [alertBox, runBox] = await Promise.all([
    alert.boundingBox(),
    run.boundingBox(),
  ]);
  expect(alertBox?.y ?? Number.POSITIVE_INFINITY).toBeLessThan(runBox?.y ?? 0);
  // Nothing was written: the stored document is byte for byte the one from
  // before the run, and the pane still names it (Q14). A title check alone
  // would pass a write that kept the old stamp.
  expect(await storedDoc(), "stored profileDoc after the refused run").toBe(docBefore);
  await expect(title).toHaveText(before ?? "");

  // The next start takes the alert away, and that run's document lands. A
  // marker in the positioning field tells the new document from the old one.
  const marker = "e2e marker for the retried profile run";
  await positioning.fill(marker);
  await run.click();
  await expect(alert).toHaveCount(0);
  await expect(run).toBeEnabled();
  await expect(alert).toHaveCount(0);
  await expect.poll(storedDoc, "stored profileDoc after the retry").not.toBe(docBefore);
  const landed = await storedDoc();
  expect(landed, "the retried document carries this tab's input").toContain(marker);
  await page.reload();
  await expect(title).toHaveText(new RegExp(`^Site profile · ${STAMP}$`, "u"));
  expect(await storedDoc(), "the retried document survives a reload").toBe(landed);
  await other.close();
});

test("the import result goes when another tab clears the saved rows (T10 a47ec61c)", async ({
  page,
}) => {
  await openView(page, "data-sources");
  await page.getByLabel("Paste a GSC export").fill(gscExport(3));
  await page.getByRole("button", { name: "Parse", exact: true }).click();
  const notice = page.locator("[data-wb-import-notice]");
  await expect(notice.locator('[data-wb-result="counts"]')).toHaveText(
    "3 rows parsed · 0 rows skipped",
  );
  await expect(page.locator("[data-wb-gsc-row]")).toHaveCount(3);

  const other = await secondTab(page);
  await openView(other, "data-sources");
  await expect(other.locator("[data-wb-gsc-row]")).toHaveCount(3);
  await other.getByRole("button", { name: "Clear", exact: true }).click();
  await other
    .getByRole("dialog", { name: "Clear the imported GSC rows?" })
    .getByRole("button", { name: "Clear", exact: true })
    .click();

  // This tab saw the rows go (the storage event arrived) ...
  await expect(page.locator("[data-wb-gsc-table]")).toContainText(
    "No GSC rows yet",
  );
  // The section wraps both the empty state and the table, so the rows
  // themselves have to be gone too (three were counted above).
  await expect(page.locator("[data-wb-gsc-row]")).toHaveCount(0);
  // ... and the result that described them went with them, with no navigation.
  await expect(notice.locator("[data-wb-result]")).toHaveCount(0);
  await expect(notice).toHaveText("");
  await other.close();
});

test("two notification switches flipped in one task both stick (T11 52eb0ec7)", async ({
  page,
}) => {
  await openView(page, "settings");
  const switches = page.locator('[data-wb-notify] input[role="switch"]');
  await expect(switches).toHaveCount(4);
  const before = await switches.evaluateAll((inputs) =>
    inputs.map((input) => (input as HTMLInputElement).checked),
  );
  // Both clicks run before React renders either: the second handler sees the
  // render the first one saw.
  await switches.evaluateAll((inputs) => {
    (inputs[0] as HTMLInputElement).click();
    (inputs[3] as HTMLInputElement).click();
  });
  const expected = [!before[0], before[1], before[2], !before[3]];
  await expect
    .poll(() =>
      switches.evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLInputElement).checked),
      ),
    )
    .toEqual(expected);
  await expect
    .poll(async () => {
      const notify = (await readStored(page))?.state.notify;
      return notify === undefined
        ? null
        : [notify.weekly, notify.drop, notify.mention, notify.gsc];
    })
    .toEqual(expected);
  await page.reload();
  await expect(switches).toHaveCount(4);
  await expect
    .poll(() =>
      switches.evaluateAll((inputs) =>
        inputs.map((input) => (input as HTMLInputElement).checked),
      ),
    )
    .toEqual(expected);
});

const SAMPLE_DECLARATION = new RegExp(
  `^Sample data: generated locally for demonstration, not measured\\. Generated ${STAMP}$`,
  "u",
);
const USER_GSC_DECLARATION = new RegExp(
  `^Includes GSC data you imported; the rest was generated locally for demonstration, not measured\\. Generated ${STAMP}$`,
  "u",
);
const SNAPSHOT_NOTE =
  "标题中的品牌与上方的站点、市场为当前项目信息；以下正文为生成时的快照，生成之后的修改不会写进正文。";

async function exportProfileMarkdown(page: Page): Promise<readonly string[]> {
  const exportButton = page
    .locator("[data-wb-pane-foot]")
    .getByRole("button", { name: "Export", exact: true });
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    exportButton.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.md$/u);
  const path = await download.path();
  return readFileSync(path, "utf8").split("\n");
}

function declarations(lines: readonly string[]): number {
  return lines.filter((line) =>
    /generated locally for demonstration, not measured/u.test(line),
  ).length;
}

test("the exported profile carries one declaration that follows its GSC rows (Q36, faf452b4)", async ({
  page,
}) => {
  await loadSample(page);
  await openView(page, "profile");
  const sample = await exportProfileMarkdown(page);
  expect(sample[0]).toMatch(SAMPLE_DECLARATION);
  expect(sample[1]).toBe("");
  expect(sample[2]).toMatch(/^# /u);
  expect(declarations(sample)).toBe(1);
  expect(sample.filter((line) => line === SNAPSHOT_NOTE)).toHaveLength(1);

  // The operator's own rows, then a fresh profile over them.
  await openView(page, "data-sources");
  await page.getByLabel("Paste a GSC export").fill(gscExport(3));
  await page.getByRole("button", { name: "Parse", exact: true }).click();
  await expect(page.locator("[data-wb-gsc-row]")).toHaveCount(3);
  await openView(page, "profile");
  const run = page.getByRole("button", {
    name: "Regenerate the profile",
    exact: true,
  });
  await run.click();
  await expect(run).toBeEnabled();
  await expect(
    page.locator('[role="alert"][data-wb-profile-stale]'),
  ).toHaveCount(0);
  const user = await exportProfileMarkdown(page);
  expect(user[0]).toMatch(USER_GSC_DECLARATION);
  expect(declarations(user)).toBe(1);
  expect(user.filter((line) => line === SNAPSHOT_NOTE)).toHaveLength(1);
});
