// @input  -- content brief page source
// @output -- regression guard for server auth, optional GSC, and account-gated shell wiring
// @pos    -- prevents the page from hiding the sign-in gate with hard-coded connected state

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PAGE = fileURLToPath(new URL("./page.tsx", import.meta.url));

describe("content brief page auth handoff", () => {
  it("reads authentication alongside GSC session and messages", () => {
    const source = readFileSync(PAGE, "utf8");

    expect(source).toContain('export const dynamic = "force-dynamic"');
    expect(source).toMatch(
      /const \[authentication, session, messages\] = await Promise\.all\(\[/,
    );
    expect(source).toContain("getServerAuthenticationStatus()");
    expect(source).toContain("readTrafficDropSession()");
    expect(source).toContain("getMessages()");
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
      /messages=\{\{\s*auth: messages\.auth,\s*tools:\s*\{\s*contentBrief: messages\.tools\.contentBrief,\s*\},\s*\}\}/s,
    );
    expect(source).not.toContain("messages={messages}");
  });

  it("passes the cookie-backed property list straight to the tool", () => {
    const source = readFileSync(PAGE, "utf8");
    expect(source).toContain("properties={session.properties}");
    expect(source).toContain('getConnectedToolContent(locale, "content-brief")');
  });
});
