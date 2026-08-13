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
    expect(markup).toContain("Tech Agent");
    expect(markup).not.toMatch(/Free public|anonymous|no account/i);
  });
});
