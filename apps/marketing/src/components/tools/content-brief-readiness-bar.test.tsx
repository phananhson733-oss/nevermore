// @vitest-environment jsdom
// @input  -- the package's contract-valid brief fixture and a fake session storage
// @output -- proof the "generate draft" control is a real handoff: it stores the versioned
//            ContentBriefHandoff, opens with rel exactly "opener", cancels when the write fails,
//            and is absent when the brief has nothing writable
// @pos    -- the brief-side half of handoff §5.1's main path; the draft-side half is
//            content-draft-tool.test.tsx

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONTENT_BRIEF_HANDOFF_KEY,
  CONTENT_BRIEF_HANDOFF_TTL_MS,
} from "@sf/public-tools/content-brief/contract";
import { parseContentBriefHandoff } from "@sf/public-tools/content-brief/parse-brief";

import { validContentBrief, withFingerprint } from "./content-brief-fixture.ts";
import { ReadinessBar } from "./content-brief-readiness-bar.tsx";
import type { Translate } from "./content-brief-results-shared.ts";

const t = ((key: string) => key) as unknown as Translate;
let root: Root | null = null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.sessionStorage.clear();
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

async function render(brief: Parameters<typeof ReadinessBar>[0]["brief"]): Promise<HTMLElement> {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<ReadinessBar brief={brief} locale="en" t={t} />);
  });
  return host;
}

async function clickLink(host: HTMLElement): Promise<boolean> {
  const link = host.querySelector("[data-generate-draft]");
  if (!(link instanceof HTMLAnchorElement)) throw new Error("no draft link");
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  await act(async () => {
    link.dispatchEvent(event);
  });
  return !event.defaultPrevented;
}

describe("ReadinessBar draft handoff", () => {
  it("opens the draft tool in a new tab with rel exactly opener", async () => {
    const host = await render(await withFingerprint(validContentBrief()));
    const link = host.querySelector("[data-generate-draft]");
    expect(link?.getAttribute("href")).toBe("/tools/content-draft");
    expect(link?.getAttribute("target")).toBe("_blank");
    expect(link?.getAttribute("rel")).toBe("opener");
  });

  it("stores the versioned handoff the draft page's parser accepts, then lets the click through", async () => {
    const brief = await withFingerprint(validContentBrief());
    const host = await render(brief);
    const before = Date.now();
    expect(await clickLink(host)).toBe(true);
    const raw = window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY);
    expect(raw).not.toBeNull();
    const stored = JSON.parse(raw ?? "null") as { version: number; created_at: number; expires_at: number };
    expect(stored.version).toBe(1);
    expect(stored.created_at).toBeGreaterThanOrEqual(before);
    expect(stored.expires_at).toBe(stored.created_at + CONTENT_BRIEF_HANDOFF_TTL_MS);
    const parsed = await parseContentBriefHandoff(JSON.parse(raw ?? "null"));
    expect(parsed.ok).toBe(true);
    expect(host.querySelector("[data-generate-draft-failed]")).toBeNull();
  });

  it("cancels navigation and says why when the browser refuses the write", async () => {
    const host = await render(await withFingerprint(validContentBrief()));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    expect(await clickLink(host)).toBe(false);
    expect(host.querySelector("[data-generate-draft-failed]")?.getAttribute("data-generate-draft-failed")).toBe(
      "storage",
    );
    expect(window.sessionStorage.getItem(CONTENT_BRIEF_HANDOFF_KEY)).toBeNull();
  });

  it("offers no draft link when the brief has nothing writable", async () => {
    const brief = validContentBrief({}, { language: "zh" });
    expect(brief.draft_readiness.writable).toEqual([]);
    const host = await render(brief);
    expect(host.querySelector("[data-generate-draft]")).toBeNull();
    expect(host.querySelector("[data-readiness-unsupported]")).not.toBeNull();
    // The JSON export stays: the visitor can still keep the brief.
    expect(host.querySelector("[data-export-json]")).not.toBeNull();
  });
});
