/** @vitest-environment jsdom */

/**
 * The input pane (plan Task 9 Step 2; design §6.7 / §12 row `profile`).
 *
 * - URL, brand and market mirror the real project and are read-only; the three
 *   editable fields are the only ones `patchProfile` accepts.
 * - There are exactly three source switches. The prototype's fourth ("AI
 *   summary") is gone: there is no model, and `ProfileDoc.ai` is never null.
 * - The run button names what it will do, and while a run is in flight says so
 *   and cannot be pressed again.
 * - "New site" became a link to the real product profile (design §12).
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Profile } from "@/lib/workbench/types";
import type { ProfileSources } from "./build-profile-doc.ts";
import {
  ProfileInputPane,
  type ProfileInputPaneProps,
} from "./ProfileInputPane.tsx";
import {
  HAN,
  PROFILE_PROJECT_ID,
  button,
  inputLabelled,
  must,
  typeInto,
} from "./profile-view-test-harness.tsx";

const en = getMessages("en").workbench;
const f = en.profile.fields;
const PROFILE: Profile = {
  url: "https://www.example.test/start",
  brand: "Example",
  market: "US",
  positioning: "analytics for SMBs",
  features: "dashboards, alerts, exports",
  competitors: "rival.test",
};
const ALL_ON: ProfileSources = { crawl: true, gsc: true, third: true };

let cleanup: (() => void) | null = null;

afterEach(() => {
  cleanup?.();
  cleanup = null;
});

function render(patch: Partial<ProfileInputPaneProps> = {}): {
  readonly scope: HTMLElement;
  readonly props: ProfileInputPaneProps;
} {
  const props: ProfileInputPaneProps = {
    projectId: PROFILE_PROJECT_ID,
    profile: PROFILE,
    srcs: ALL_ON,
    running: false,
    stale: false,
    hasDoc: false,
    onRun: vi.fn(),
    onPatch: vi.fn(),
    onSrcsChange: vi.fn(),
    ...patch,
  };
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  act(() =>
    root.render(
      <NextIntlClientProvider
        locale="en"
        messages={getMessages("en")}
        timeZone="UTC"
      >
        <ProfileInputPane {...props} />
      </NextIntlClientProvider>,
    ),
  );
  cleanup = () => {
    act(() => root.unmount());
    container.remove();
  };
  return { scope: container, props };
}

function switches(scope: ParentNode): readonly HTMLInputElement[] {
  return [...scope.querySelectorAll<HTMLInputElement>('input[role="switch"]')];
}

describe("ProfileInputPane fields", () => {
  it("shows the project's URL, brand and market read-only", () => {
    const { scope, props } = render();
    const readOnly = [f.url, f.brand, f.market].map((label) =>
      inputLabelled(scope, label),
    );
    expect(readOnly.map((input) => input.value)).toEqual([
      PROFILE.url,
      "Example",
      "US",
    ]);
    expect(readOnly.map((input) => input.readOnly)).toEqual([true, true, true]);
    for (const input of readOnly) typeInto(input, "changed");
    expect(props.onPatch).not.toHaveBeenCalled();
  });

  it("lets the three editable fields through patchProfile, one field per edit", () => {
    const { scope, props } = render();
    const editable = [f.positioning, f.features, f.competitors].map((label) =>
      inputLabelled(scope, label),
    );
    expect(editable.map((input) => input.readOnly)).toEqual([
      false,
      false,
      false,
    ]);
    typeInto(must(editable[0]), "new line");
    typeInto(must(editable[1]), "a, b");
    typeInto(must(editable[2]), "c.test");
    expect(vi.mocked(props.onPatch).mock.calls).toEqual([
      [{ positioning: "new line" }],
      [{ features: "a, b" }],
      [{ competitors: "c.test" }],
    ]);
  });

  it("gives the URL its domain and the lists their counts as meta", () => {
    const { scope } = render();
    // `Field` puts the meta right after the label.
    const meta = (label: string): string =>
      must(
        [...scope.querySelectorAll("label")].find(
          (l) => l.textContent === label,
        )?.nextElementSibling,
      ).textContent ?? "";
    expect(meta(f.url)).toBe("example.test");
    expect(meta(f.positioning)).toBe("18 characters");
    expect(meta(f.features)).toBe("3 items");
    expect(meta(f.competitors)).toBe("1 item");
    // Brand and market carry no meta at all, not an empty one.
    const brandLabel = [...scope.querySelectorAll("label")].find(
      (l) => l.textContent === f.brand,
    );
    expect(must(brandLabel).nextElementSibling).toBeNull();
  });

  it("says the three mirrored fields come from the real product profile", () => {
    expect(render().scope.textContent).toContain(en.profile.readonlyNote);
  });
});

describe("ProfileInputPane sources", () => {
  it("has exactly the three source switches, reflecting the current choice", () => {
    const { scope } = render({
      srcs: { crawl: true, gsc: false, third: true },
    });
    const found = switches(scope);
    const labels = found.map(
      (input) =>
        must(scope.querySelector(`label[for="${input.id}"]`)).textContent,
    );
    expect(labels).toEqual([
      en.profile.sources.crawl,
      en.profile.sources.gsc,
      en.profile.sources.third,
    ]);
    expect(found.map((input) => input.checked)).toEqual([true, false, true]);
  });

  it("hands back the whole choice with one switch flipped", () => {
    const { scope, props } = render();
    act(() => must(switches(scope)[1]).click());
    expect(props.onSrcsChange).toHaveBeenCalledWith({
      crawl: true,
      gsc: false,
      third: true,
    });
  });

  it("states that everything is generated locally", () => {
    expect(render().scope.textContent).toContain(en.profile.run.note);
  });
});

describe("ProfileInputPane run button", () => {
  it("offers to generate when there is no profile yet", () => {
    const { scope, props } = render();
    act(() => button(scope, en.profile.run.button).click());
    expect(props.onRun).toHaveBeenCalledTimes(1);
  });

  it("offers to regenerate when there is one", () => {
    expect(
      button(render({ hasDoc: true }).scope, en.profile.run.rerun).disabled,
    ).toBe(false);
  });

  it("says it is generating and cannot be pressed while a run is in flight", () => {
    const { scope, props } = render({ running: true, hasDoc: true });
    const busy = button(scope, en.profile.run.busy);
    expect(busy.disabled).toBe(true);
    act(() => busy.click());
    expect(props.onRun).not.toHaveBeenCalled();
  });

  it("links to the real product profile instead of creating a site", () => {
    const link = must(
      [...render().scope.querySelectorAll("a")].find(
        (a) => a.textContent === en.profile.legacyCta,
      ),
    );
    expect(link.getAttribute("href")).toBe(`/p/${PROFILE_PROJECT_ID}/context`);
  });
});

describe("ProfileInputPane frame", () => {
  it("marks framework copy and keeps it English in en (Q30)", () => {
    const frames = [...render().scope.querySelectorAll("[data-wb-frame]")];
    expect(frames.length).toBeGreaterThanOrEqual(1);
    expect(
      frames
        .map((frame) => frame.textContent ?? "")
        .join("")
        .trim(),
    ).not.toBe("");
    for (const frame of frames) {
      expect(frame.textContent ?? "", frame.outerHTML).not.toMatch(HAN);
      expect(frame.textContent ?? "").not.toContain("workbench.");
    }
  });

  it("renders no inline style", () => {
    expect(render().scope.querySelector("[style]")).toBeNull();
  });
});
