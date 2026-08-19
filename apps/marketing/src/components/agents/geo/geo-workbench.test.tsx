// @vitest-environment jsdom
// @input  -- the confirm-first workbench driven through its own inputs
// @output -- proof nothing is inferred, defaulted, or billed without confirmation
// @pos    -- component test for the GEO Agent's pre-payment workflow

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import en from "../../../i18n/messages/en.json";

/**
 * The sign-in dialog reaches marketing UI through the `@/` alias, which the
 * unit project cannot resolve for a marketing importer. Stubbed for the same
 * reason the sibling Agent workbench test stubs it: this file is about what
 * happens BEFORE the dialog opens.
 */
vi.mock("../../auth/sign-in-dialog", () => ({
  SignInDialog: ({ open }: { readonly open: boolean }) => (
    <div data-testid="sign-in-dialog" data-open={String(open)} />
  ),
}));

const { GeoWorkbench } = await import("./geo-workbench");

function setValue(element: HTMLInputElement | HTMLSelectElement, value: string) {
  const prototype =
    element instanceof HTMLSelectElement
      ? HTMLSelectElement.prototype
      : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  setter?.call(element, value);
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

describe("GeoWorkbench", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Promise.resolve(
          new Response(JSON.stringify({ signedIn: false }), { status: 200 }),
        ),
      ),
    );
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });

  function render(): void {
    act(() => {
      root.render(
        <NextIntlClientProvider
          locale="en"
          timeZone="UTC"
          messages={{ agents: en.agents }}
        >
          <GeoWorkbench locale="en" />
        </NextIntlClientProvider>,
      );
    });
  }

  function field(id: string): HTMLInputElement {
    return host.querySelector<HTMLInputElement>(`#${id}`)!;
  }

  async function fillContext(market = "US"): Promise<void> {
    await act(async () => {
      setValue(field("geo-url"), "https://acme.test/");
      setValue(field("geo-product"), "Acme Analytics");
      setValue(field("geo-category"), "seo");
      setValue(field("geo-buyer"), "ceo");
      setValue(field("geo-rivals"), "semrush");
      setValue(
        host.querySelector<HTMLSelectElement>("#geo-market")!,
        market,
      );
    });
  }

  /**
   * Let the confirmation settle.
   *
   * Confirming the context hashes it with `crypto.subtle`, which is genuinely
   * asynchronous, so a microtask flush is not enough to reach the next stage.
   */
  async function flush(ticks = 6): Promise<void> {
    for (let tick = 0; tick < ticks; tick += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  }

  function button(label: string): HTMLButtonElement | undefined {
    return [...host.querySelectorAll("button")].find((element) =>
      element.textContent?.includes(label),
    );
  }

  async function confirmContext(market = "US"): Promise<void> {
    render();
    await fillContext(market);
    await act(async () => {
      button("Review the facts")!.click();
    });
    await act(async () => {
      for (const checkbox of host.querySelectorAll<HTMLInputElement>(
        'input[type="checkbox"]',
      )) {
        checkbox.click();
      }
    });
    await act(async () => {
      button("Confirm and generate the questions")!.click();
    });
    await flush();
  }

  it("offers no preselected market and no EU or UK option", () => {
    render();
    const select = host.querySelector<HTMLSelectElement>("#geo-market")!;

    // A default market would sell an uncalibrated run as a calibrated one.
    expect(select.value).toBe("");
    const codes = [...select.options].map((option) => option.value);
    expect(codes).not.toContain("EU");
    expect(codes).not.toContain("UK");
    expect(codes).toContain("GB");
  });

  it("keeps the review step out of reach until every fact is entered", () => {
    render();

    expect(button("Review the facts")!.disabled).toBe(true);
  });

  it("proposes brand names without confirming any of them", async () => {
    render();
    await fillContext();
    await act(async () => {
      button("Review the facts")!.click();
    });

    const checkboxes = [
      ...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'),
    ];
    expect(checkboxes.length).toBeGreaterThan(1);
    // Every proposal arrives unticked, including the category confirmation.
    expect(checkboxes.every((checkbox) => !checkbox.checked)).toBe(true);
    expect(button("Confirm and generate the questions")!.disabled).toBe(true);
    expect(host.textContent).toContain("inferred from the hostname");
  });

  it("says the confirmed facts were not server-verified", async () => {
    render();
    await fillContext();
    await act(async () => {
      button("Review the facts")!.click();
    });

    expect(host.textContent).toContain(
      "Nothing here has been verified against your site by a server",
    );
  });

  it("shows the exact eighteen-call plan before the run button", async () => {
    await confirmContext();

    expect(host.textContent).toContain("18 provider calls");
    expect(host.textContent).toContain(
      "5 retrieval probes × 3 samples = 15 calls",
    );
    expect(host.textContent).toContain(
      "3 natural-demand questions × 1 sample = 3 calls",
    );
    expect(button("Run 18 provider calls")).toBeDefined();
  });

  it("marks the question that already contains the customer's own brand", async () => {
    await confirmContext();

    expect(host.textContent).toContain("Contains your brand");
    expect(host.textContent).toContain("Measured wording");
  });

  it("renders the calibrated retrieval strings verbatim", async () => {
    await confirmContext();
    const values = [
      ...host.querySelectorAll<HTMLInputElement>('input[id^="geo-q-"]'),
    ].map((input) => input.value);

    expect(values).toContain("What are the top seo tools right now?");
    expect(values).toContain("Best alternatives to semrush for seo");
  });

  it("demotes an edited retrieval probe out of measured status", async () => {
    await confirmContext();
    const input = host.querySelector<HTMLInputElement>(
      "#geo-q-core-category_discovery",
    )!;

    await act(async () => {
      setValue(input, "Which seo tools do enterprise teams trust?");
    });
    await flush();

    expect(host.textContent).toContain("Edited · not measured");
  });

  it("warns before charging when the market is outside the calibration", async () => {
    await confirmContext("DE");

    expect(host.textContent).toContain(
      "calibrated with US market settings",
    );
    expect(host.textContent).toContain("DE");
  });

  it("does not warn about calibration for the calibrated market", async () => {
    await confirmContext("US");

    expect(host.textContent).not.toContain(
      "has not been independently calibrated",
    );
  });

  it("opens the sign-in dialog instead of billing a signed-out visitor", async () => {
    await confirmContext();
    const runFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    runFetch.mockClear();

    await act(async () => {
      button("Run 18 provider calls")!.click();
    });
    await flush();

    const calls = runFetch.mock.calls.map((call) => String(call[0]));
    expect(calls).toContain("/api/auth/session");
    expect(calls).not.toContain("/api/agents/geo/run");
  });

  it("moves the visitor to the reason when a run is refused", async () => {
    // Regression: the banner renders at the top of the workbench, the run
    // button sits at the bottom of the eight-question list, and a refusal sends
    // the visitor back to that list. Before this the banner appeared hundreds of
    // pixels above the viewport, so a refused run — including one that had
    // already been billed — was indistinguishable from a button that did
    // nothing. Found by /qa on 2026-08-18.
    const scrollIntoView = vi.fn();
    // jsdom implements no scrolling at all, so this is defined rather than spied.
    (
      Element.prototype as unknown as { scrollIntoView: unknown }
    ).scrollIntoView = scrollIntoView;

    await confirmContext();
    const runFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    runFetch.mockImplementation(async (input: unknown) =>
      String(input) === "/api/auth/session"
        ? new Response(JSON.stringify({ signedIn: true }), { status: 200 })
        : new Response(
            JSON.stringify({ error: { code: "geo_client_outdated" } }),
            { status: 409 },
          ),
    );

    await act(async () => {
      button("Run 18 provider calls")!.click();
    });
    await flush();

    const alert = host.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(en.agents.geo.errors.geo_client_outdated);
    expect(scrollIntoView).toHaveBeenCalled();
    // Focus lands on the container that holds the banner, not on whatever the
    // question list left focused.
    expect(document.activeElement).toBe(alert?.parentElement);
  });
});
