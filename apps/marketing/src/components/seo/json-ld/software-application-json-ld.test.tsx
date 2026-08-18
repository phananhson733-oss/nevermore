// @input  -- homepage SoftwareApplication JSON-LD component
// @output -- regression guard against anonymous-audit structured-data claims
// @pos    -- keeps crawler-facing homepage claims aligned with the account-gated Agents

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SoftwareApplicationJsonLd } from "./software-application-json-ld.tsx";

describe("SoftwareApplicationJsonLd", () => {
  it("describes account-gated, non-persistent Agent audits", () => {
    const markup = renderToStaticMarkup(<SoftwareApplicationJsonLd />);

    expect(markup).toContain("verified GenGrowth account");
    expect(markup).toContain("No persistence");
    expect(markup).toContain("SEO Agent");
    // One Agent. This is the crawler-facing description of the product model, and
    // it advertised a second, separate Agent after the product stopped having
    // one — structured data is a claim, and it outlives the page copy in caches.
    expect(markup).not.toContain("Tech Agent");
    expect(markup).toContain("The same Agent, opened on");
    expect(markup).not.toMatch(/Free public|anonymous|no account/i);
    /**
     * The tools are free during the welfare period, not free as a property of
     * the product. A permanent "no payment required" is a promise nobody made.
     */
    expect(markup).not.toContain("No payment");
    expect(markup).toContain("Free while the tools are being tested");
  });
});
