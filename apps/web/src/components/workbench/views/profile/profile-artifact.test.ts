/**
 * What each output tab hands to `useAddArtifact` (plan Task 9 Step 4; research
 * §3.3). The bodies are checked by independent landmarks (the heading the
 * document opens with, the prompt's fixed first line, a parsed JSON field)
 * rather than by calling the same builder a second time.
 */
import { describe, expect, it } from "vitest";
import { FIXTURE_DOC, FIXTURE_PROFILE } from "@/lib/workbench/mock/builders/builder-fixtures";
import { isProfileTab, PROFILE_TABS, profileArtifactDraft } from "./profile-artifact.ts";

describe("profileArtifactDraft", () => {
  it("doc tab: the markdown document as an md artifact of the profile module", () => {
    const draft = profileArtifactDraft("doc", FIXTURE_PROFILE, FIXTURE_DOC, "Acme site profile");
    expect(draft).toMatchObject({
      module: "profile",
      type: "md",
      engine: "both",
      title: "Acme site profile",
      filename: "product-profile.md",
    });
    expect(draft.body.startsWith("# Acme 产品档案\n")).toBe(true);
    expect(draft.body).toContain("## 搜索表现（示例数据）");
  });

  it("doc tab: the GSC label is the snapshot's, so user rows carry none", () => {
    const draft = profileArtifactDraft("doc", FIXTURE_PROFILE, { ...FIXTURE_DOC, gscSource: "user" }, "t");
    expect(draft.body).toContain("## 搜索表现\n");
    expect(draft.body).not.toContain("## 搜索表现（");
  });

  it("json tab: the profile JSON with the AI document as a sub-object", () => {
    const draft = profileArtifactDraft("json", FIXTURE_PROFILE, FIXTURE_DOC, "Acme site profile JSON");
    expect(draft).toMatchObject({ module: "profile", type: "json", engine: "both", filename: "profile.json" });
    const parsed = JSON.parse(draft.body) as { brand: string; ai: { summary: string } };
    expect(parsed.brand).toBe("Acme");
    expect(parsed.ai.summary).toBe("[示例] Acme：给小团队用的 SEO 检查工具");
  });

  it("ctx tab: the context prompt, with no file name of its own", () => {
    const draft = profileArtifactDraft("ctx", FIXTURE_PROFILE, FIXTURE_DOC, "Acme context block");
    expect(draft).toMatchObject({ module: "profile", type: "prompt", engine: "both" });
    expect(Object.hasOwn(draft, "filename")).toBe(false);
    expect(draft.body.startsWith("# 产品背景\n")).toBe(true);
  });

  it("ctx tab: user rows are not announced as sample data", () => {
    const draft = profileArtifactDraft("ctx", FIXTURE_PROFILE, { ...FIXTURE_DOC, gscSource: "user" }, "t");
    expect(draft.body).toContain('"sampleData": false');
  });
});

describe("profile tabs", () => {
  it("are exactly doc, json and ctx, in that order", () => {
    expect(PROFILE_TABS).toEqual(["doc", "json", "ctx"]);
  });

  it("recognise only those ids", () => {
    expect(["doc", "json", "ctx", "ai", "", "DOC"].map(isProfileTab)).toEqual([true, true, true, false, false, false]);
  });
});
