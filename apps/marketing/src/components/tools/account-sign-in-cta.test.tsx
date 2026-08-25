// @vitest-environment jsdom
// @input  -- an account-gated tool CTA label and the shared sign-in dialog
// @output -- a semantic button that opens the existing controlled dialog
// @pos    -- interaction contract for signed-out account-gated tool heroes

import { act, type ComponentType } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Props = {
  readonly label: string;
  readonly className: string;
};

const signInDialogMock = vi.hoisted(() =>
  vi.fn(({ open }: { readonly open: boolean }) =>
    open ? <div data-testid="sign-in-dialog">sign in</div> : null,
  ),
);

vi.mock("../auth/sign-in-dialog", () => ({
  SignInDialog: signInDialogMock,
}));

let AccountSignInCta: ComponentType<Props>;
try {
  const modulePath = "./account-sign-in-cta.tsx";
  ({ AccountSignInCta } = await import(/* @vite-ignore */ modulePath));
} catch {
  AccountSignInCta = ({ label, className }) => (
    <button type="button" className={className}>
      {label}
    </button>
  );
}

let root: Root | null = null;

beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  signInDialogMock.mockClear();
});

afterEach(async () => {
  if (root !== null) {
    await act(async () => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
});

describe("AccountSignInCta", () => {
  it("opens the shared sign-in dialog from a semantic button", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <AccountSignInCta
          label="Sign in to analyze competitors"
          className="focus-visible:outline-2 account-cta"
        />,
      );
    });

    const button = host.querySelector("button");
    expect(button?.type).toBe("button");
    expect(button?.textContent).toBe("Sign in to analyze competitors");
    expect(button?.className).toContain("focus-visible:outline-2");

    await act(async () => {
      button?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(host.querySelector('[data-testid="sign-in-dialog"]')).not.toBeNull();
    expect(signInDialogMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ open: true }),
      undefined,
    );
  });
});
