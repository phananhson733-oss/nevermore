// @vitest-environment jsdom
// @input  -- the draft panel against a stubbed endpoint
// @output -- proof each state says what happened, and that a draft is asked for
// @pos    -- unit coverage for the only Stage 04 surface that calls a model

import { describe, expect, it, vi, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { NextIntlClientProvider } from "next-intl";
import type { SeoAuditTargetPageExtract } from "@sf/public-tools";

import {
  AgentSolutionDraft,
  draftKindFor,
} from "./agent-solution-draft";
import { DRAFT_ERROR_CODES } from "../../lib/agents/draft-handler";
import enMessages from "../../i18n/messages/en.json";

const MESSAGES = {
  agents: {
    workbench: {
      recommendations: {
        draft: enMessages.agents.workbench.recommendations.draft,
      },
    },
  },
};

const EXTRACT: SeoAuditTargetPageExtract = {
  url: "https://acme.test/chart",
  title: "Chart",
  metaDescription: "A chart page",
  h1: ["Chart"],
  subHeadings: ["How to read it"],
  openingText: "Enter a birth date.",
  staticBodyWords: 120,
  staticBodyUnits: { units: 120, basis: "words" },
  termFrequencies: null,
  truncatedLists: false,
  response: {
    status: 200,
    finalStatus: 200,
    redirectHops: 0,
    responseMs: 40,
    contentType: "text/html; charset=utf-8",
    canonicalTarget: "https://acme.test/chart",
    robotsIndexable: true,
    robotsDirectives: [],
    sitemapMember: true,
    jsonLdTypes: [],
    jsonLdErrorCount: 0,
    internalOutlinks: 3,
    internalOutlinksWithoutAnchorText: 0,
  },
  declared: null,
};

let root: Root | null = null;
let host: HTMLElement | null = null;

function render(extract: SeoAuditTargetPageExtract | null = EXTRACT) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root!.render(
      <NextIntlClientProvider locale="en" timeZone="UTC" messages={MESSAGES}>
        <AgentSolutionDraft
          kind="search-presentation"
          targetUrl="https://acme.test/chart"
          extract={extract}
          targetQuery="natal chart"
          pageType="Tool"
        />
      </NextIntlClientProvider>,
    );
  });
  return host;
}

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  vi.unstubAllGlobals();
});

describe("draftKindFor", () => {
  it("offers a draft only where a model can write something true", () => {
    expect(draftKindFor("search-presentation")).toBe("search-presentation");
    expect(draftKindFor("heading-structure")).toBe("heading-structure");
    // A redirect rule or a canonical target is decided by facts this run
    // already measured; asking a model for one would dress a guess as an answer.
    expect(draftKindFor("redirect")).toBeNull();
    expect(draftKindFor("canonical")).toBeNull();
    expect(draftKindFor("performance")).toBeNull();
  });
});

describe("AgentSolutionDraft", () => {
  it("withholds the offer when the page's own text was never collected", () => {
    // A draft with nothing true to build on is the empty form again, wearing a
    // button.
    expect(render(null).textContent).toBe("");
  });

  it("sends the page's own text and renders the returned draft", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: {
          draft: {
            kind: "search-presentation",
            title: "Free natal chart calculator",
            metaDescription: "Draw your natal chart from a birth date.",
            openingLine: "Enter a birth date to draw your chart.",
          },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const element = render();

    const button = element.querySelector("button")!;
    await act(async () => {
      button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    const call = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(call[1].body));
    expect(body).toMatchObject({
      kind: "search-presentation",
      url: "https://acme.test/chart",
      title: "Chart",
      targetQuery: "natal chart",
    });
    // The H1 and the sub-headings are one list to the prompt: the page's own
    // outline, in page order.
    expect(body.headings).toEqual(["Chart", "How to read it"]);

    expect(element.textContent).toContain("Free natal chart calculator");
    expect(element.textContent).toContain("Draw your natal chart");
    // The button is gone once a draft is shown; a second offer beside a result
    // reads as the first one not having worked.
    expect(element.querySelector("button")).toBeNull();
  });

  it("explains a refusal in the terms the endpoint used", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: { code: "rate_limited" } }, { status: 429 }),
      ),
    );
    const element = render();

    await act(async () => {
      element
        .querySelector("button")!
        .dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(element.textContent).toContain("used this hour's drafts");
    // Still offered: a spent hour is a wait, not a dead end.
    expect(element.querySelector("button")).not.toBeNull();
  });

  it("ships copy for every code the endpoint can return", async () => {
    // The panel prints `errors.<code>` straight from the endpoint, and
    // next-intl renders a missing key as its own dotted path rather than
    // throwing — so a code with no copy would reach a visitor as a message key.
    const [en, zh] = await Promise.all([
      import("../../i18n/messages/en.json"),
      import("../../i18n/messages/zh.json"),
    ]);
    // Derived from the endpoint's own union, not a second list beside it: a
    // hand-kept copy stays green when an eighth code ships without copy.
    const codes = [...DRAFT_ERROR_CODES];
    for (const catalogue of [en.default, zh.default]) {
      const errors = (
        catalogue as unknown as {
          agents: {
            workbench: {
              recommendations: { draft: { errors: Record<string, string> } };
            };
          };
        }
      ).agents.workbench.recommendations.draft.errors;
      expect(Object.keys(errors).sort()).toEqual(codes.slice().sort());
    }
  });
});
