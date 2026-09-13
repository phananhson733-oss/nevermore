/** @vitest-environment jsdom */

/**
 * The delete block's contract is almost entirely *interaction*: which buttons
 * exist, where focus lands when one of them unmounts, and whether a second
 * DELETE can be fired while the post-success navigation is still in flight.
 * None of that is reachable from static markup, so the real client component is
 * driven through `createRoot` with only the router, the delete mutation and the
 * workbench store hook stubbed.
 */

import { act } from "react";
import { createRoot } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { getMessages } from "@sf/i18n";
import { beforeEach, describe, expect, it, vi } from "vitest";

const en = getMessages("en");

const mocks = vi.hoisted(() => ({
  router: { replace: vi.fn(), refresh: vi.fn() },
  forgetProject: vi.fn(),
  // Only the fields `DeleteProjectSection` reads off `useDeleteProject()`.
  mutation: {
    mutateAsync: vi.fn(),
    reset: vi.fn(),
    isPending: false,
    isSuccess: false,
    isError: false,
    error: null as unknown,
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/lib/api", () => ({ useDeleteProject: () => mocks.mutation }));
vi.mock("@/lib/workbench/store/hooks", () => ({
  useWorkbench: () => ({ forgetProject: mocks.forgetProject }),
}));

const { DeleteProjectSection } = await import("./DeleteProjectSection.tsx");

// React only suppresses false-positive concurrent-render warnings when a test
// harness explicitly declares that state transitions are wrapped in `act`.
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

const PROJECT_ID = "00000000-0000-4000-8000-000000000900";
const COPY = {
  trigger: "Delete product",
  cancel: "Keep product",
  confirm: "Confirm deletion",
  deleting: "Deleting…",
  error: "We couldn't confirm whether the product was deleted. Refresh the project list to check, then try again if it is still there.",
  realAction: "Not sample data",
  realActionTitle: "This deletes the real project. It is not sample data.",
} as const;

function clientRender() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  // A fresh element every time: re-rendering one identical element bails out
  // before the component can re-read the mutation stub.
  const tree = () => (
    <NextIntlClientProvider locale="en" messages={en} timeZone="UTC">
      <DeleteProjectSection projectId={PROJECT_ID} />
    </NextIntlClientProvider>
  );
  act(() => root.render(tree()));
  return {
    container,
    rerender() {
      act(() => root.render(tree()));
    },
    cleanup() {
      act(() => root.unmount());
      container.remove();
    },
  };
}

function buttons(scope: ParentNode): readonly HTMLButtonElement[] {
  return [...scope.querySelectorAll("button")];
}

function buttonWith(scope: ParentNode, label: string): HTMLButtonElement {
  const found = buttons(scope).find((node) => node.textContent === label);
  if (!found) throw new Error(`No button labelled ${label}`);
  return found;
}

function group(scope: ParentNode): HTMLElement {
  const found = scope.querySelector<HTMLElement>('[role="group"]');
  if (!found) throw new Error("The confirmation group is not rendered");
  return found;
}

beforeEach(() => {
  mocks.router.replace.mockReset();
  mocks.router.refresh.mockReset();
  mocks.forgetProject.mockReset();
  mocks.mutation.reset.mockReset();
  mocks.mutation.mutateAsync.mockReset();
  mocks.mutation.mutateAsync.mockResolvedValue(undefined);
  mocks.mutation.isPending = false;
  mocks.mutation.isSuccess = false;
  mocks.mutation.isError = false;
});

describe("DeleteProjectSection", () => {
  it("opens the confirmation from a single trigger and focuses the confirm button", () => {
    const view = clientRender();
    expect(buttons(view.container).map((node) => node.textContent)).toEqual([COPY.trigger]);
    expect(view.container.querySelector('[role="group"]')).toBeNull();
    expect(document.activeElement).not.toBe(buttonWith(view.container, COPY.trigger));

    act(() => buttonWith(view.container, COPY.trigger).click());

    const confirmGroup = group(view.container);
    expect(buttons(confirmGroup).map((node) => node.textContent)).toEqual([
      COPY.cancel,
      COPY.confirm,
    ]);
    expect(document.activeElement).toBe(buttonWith(confirmGroup, COPY.confirm));
    view.cleanup();
  });

  it("returns focus to the trigger when the confirmation is cancelled", () => {
    const view = clientRender();
    act(() => buttonWith(view.container, COPY.trigger).click());
    act(() => buttonWith(group(view.container), COPY.cancel).click());

    expect(view.container.querySelector('[role="group"]')).toBeNull();
    expect(document.activeElement).toBe(buttonWith(view.container, COPY.trigger));
    expect(mocks.mutation.mutateAsync).not.toHaveBeenCalled();
    view.cleanup();
  });

  it("forgets the project, navigates once, and stays disabled after success", async () => {
    const view = clientRender();
    act(() => buttonWith(view.container, COPY.trigger).click());
    await act(async () => {
      buttonWith(group(view.container), COPY.confirm).click();
    });

    expect(mocks.mutation.mutateAsync).toHaveBeenCalledTimes(1);
    expect(mocks.forgetProject).toHaveBeenCalledTimes(1);
    expect(mocks.router.replace).toHaveBeenCalledTimes(1);
    expect(mocks.router.replace).toHaveBeenCalledWith("/");

    mocks.mutation.isSuccess = true;
    view.rerender();

    const settled = buttons(group(view.container));
    expect(settled.map((node) => node.disabled)).toEqual([true, true]);
    expect(settled.map((node) => node.textContent)).toEqual([COPY.cancel, COPY.deleting]);
    view.cleanup();
  });

  it("reports a failed delete without navigating or forgetting the project", async () => {
    mocks.mutation.mutateAsync.mockRejectedValueOnce(new Error("delete failed"));
    const view = clientRender();
    act(() => buttonWith(view.container, COPY.trigger).click());
    await act(async () => {
      buttonWith(group(view.container), COPY.confirm).click();
    });

    mocks.mutation.isError = true;
    view.rerender();

    expect(view.container.querySelector('[role="alert"]')?.textContent).toBe(COPY.error);
    expect(mocks.router.replace).not.toHaveBeenCalled();
    expect(mocks.router.refresh).not.toHaveBeenCalled();
    expect(mocks.forgetProject).not.toHaveBeenCalled();
    view.cleanup();
  });

  it("marks the block as a real action rather than sample data", () => {
    const view = clientRender();
    const section = view.container.querySelector("[data-wb-real-action]");
    expect(section).not.toBeNull();
    const chip = section?.querySelector("span[title]");
    expect(chip?.textContent).toBe(COPY.realAction);
    expect(chip?.getAttribute("title")).toBe(COPY.realActionTitle);
    view.cleanup();
  });
});
