/**
 * `setNotify` writes one switch (codex S11 #2). The settings block used to send
 * the whole preference object, built from the `notify` it had rendered; two
 * flips in one frame, or a flip landing after another tab's `loadPersisted`,
 * then wrote the sibling switches back to what that render showed. The action
 * now carries a key and a value, and the reducer merges them into the `notify`
 * it holds when the action runs.
 *
 * Expected values are written out, not derived from `DEFAULT_NOTIFY`, so a
 * reducer that merged into the default (or into the initial state) fails here.
 * The component-level race (two handlers of one render) is pinned in
 * `NotifyBlock.test.tsx`.
 */
import { describe, expect, it } from "vitest";
import type { WorkbenchProjectState } from "../types.ts";
import { DEFAULT_NOTIFY, initialProjectState, reduce } from "./reducer.ts";

const seed = { url: "https://example.test", brand: "Example", market: "US" };

/** Another tab's notify, as `loadPersisted` would hand it over: not the default. */
function persistedFromAnotherTab(): WorkbenchProjectState {
  const own = initialProjectState(seed);
  return reduce(own, {
    type: "loadPersisted",
    state: {
      ...own,
      notify: { weekly: false, drop: false, mention: true, gsc: false },
    },
  });
}

describe("setNotify", () => {
  it("keeps both writes when two actions for different keys were built before either ran", () => {
    const before = initialProjectState(seed);
    const weeklyOff = {
      type: "setNotify",
      key: "weekly",
      value: false,
    } as const;
    const mentionOn = {
      type: "setNotify",
      key: "mention",
      value: true,
    } as const;

    const after = reduce(reduce(before, weeklyOff), mentionOn);

    expect(after.notify).toEqual({
      weekly: false,
      drop: true,
      mention: true,
      gsc: true,
    });
  });

  it("merges into the notify it holds now, including one another tab just replaced", () => {
    const replaced = persistedFromAnotherTab();
    expect(replaced.notify).toEqual({
      weekly: false,
      drop: false,
      mention: true,
      gsc: false,
    });

    const after = reduce(replaced, {
      type: "setNotify",
      key: "drop",
      value: true,
    });

    expect(after.notify).toEqual({
      weekly: false,
      drop: true,
      mention: true,
      gsc: false,
    });
  });

  it("changes nothing but that switch, and leaves the previous state and the default untouched", () => {
    const before = initialProjectState(seed);

    const after = reduce(before, {
      type: "setNotify",
      key: "gsc",
      value: false,
    });

    expect(after).not.toBe(before);
    expect(after.notify).toEqual({
      weekly: true,
      drop: true,
      mention: false,
      gsc: false,
    });
    expect(after.notify).not.toBe(before.notify);
    expect(after.profile).toBe(before.profile);
    expect(after.artifacts).toBe(before.artifacts);
    expect(after.gscRows).toBe(before.gscRows);
    expect(after.demo).toBe(before.demo);
    expect(before.notify).toEqual({
      weekly: true,
      drop: true,
      mention: false,
      gsc: true,
    });
    expect(DEFAULT_NOTIFY).toEqual({
      weekly: true,
      drop: true,
      mention: false,
      gsc: true,
    });
  });

  it("hands back the same state when the switch already has that value", () => {
    const before = persistedFromAnotherTab();

    expect(
      reduce(before, { type: "setNotify", key: "mention", value: true }),
    ).toBe(before);
    expect(
      reduce(before, { type: "setNotify", key: "weekly", value: false }),
    ).toBe(before);
    expect(
      reduce(before, { type: "setNotify", key: "weekly", value: true }),
    ).not.toBe(before);
  });
});
