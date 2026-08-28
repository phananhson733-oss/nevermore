// @input  -- content draft page source
// @output -- regression guard for server auth, scoped messages, and account-gated shell wiring
// @pos    -- prevents the page from hiding the sign-in gate with hard-coded connected state

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PAGE = fileURLToPath(new URL("./page.tsx", import.meta.url));

describe("content draft page auth handoff", () => {
  it("reads authentication alongside messages on every request", () => {
    const source = readFileSync(PAGE, "utf8");

    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).toMatch(/const \[authentication, messages\] = await Promise\.all\(\[/);
    expect(source).toContain("getServerAuthenticationStatus()");
    expect(source).toContain("getMessages()");
    // No Search Console read: the draft takes a brief, never a property.
    expect(source).not.toContain("readTrafficDropSession");
  });

  it("shows the account gate from verified server auth instead of hard-coding connected", () => {
    const source = readFileSync(PAGE, "utf8");

    expect(source).toContain('connected={authentication === "authenticated"}');
    expect(source).toContain("accountGated");
    expect(source).toContain("compactConnected");
    expect(source).not.toMatch(/content=\{content\}\s+connected>/);
  });

  it("gives client sign-in dialogs auth copy without serializing the full catalog", () => {
    const source = readFileSync(PAGE, "utf8");

    expect(source).toMatch(
      /messages=\{\{\s*auth: messages\.auth,\s*tools:\s*\{\s*contentDraft: messages\.tools\.contentDraft,\s*\},\s*\}\}/s,
    );
    expect(source).not.toContain("messages={messages}");
  });

  it("mounts the draft tool under the content-draft shell content", () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain("<ContentDraftTool locale={locale} />");
    expect(source).toContain('getConnectedToolContent(locale, "content-draft")');
  });
});
