// @input  -- the package's draft fixture (a DraftResult assembled the way the handler builds one)
// @output -- proof the Markdown and JSON projections agree with the result they were made from:
//            the H2 list item for item, gap sentences character for character
// @pos    -- handoff §5.5 / §8 items 29 and 30, at the pure-function level; the rendered half
//            lives in i18n/content-draft-messages.test.tsx

import { describe, expect, it } from "vitest";
import type { DraftResult } from "@sf/public-tools/content-brief/contract";
import {
  draftBrief,
  draftResultFixture,
} from "@sf/public-tools/content-brief/draft-fixtures";

import {
  draftExportJson,
  draftMarkdown,
  gapSentences,
  markdownHeadings,
  type MarkdownNotes,
} from "./content-draft-markdown.ts";

const NOTES: MarkdownNotes = {
  failed: (reason) => `failed: ${reason}`,
  skipped: "skipped",
};

async function result(options: Parameters<typeof draftResultFixture>[1] = {}): Promise<DraftResult> {
  return draftResultFixture(await draftBrief(), options);
}

describe("draftMarkdown", () => {
  it("lists every section's H2 in order, body or not", async () => {
    const draft = await result({ failSection: "O2", skipSection: "O3" });
    const markdown = draftMarkdown(draft, NOTES);
    expect(markdownHeadings(markdown)).toEqual(draft.sections.map((section) => section.h2));
    expect(markdown.startsWith(`# ${draft.brief_ref.keyword}\n`)).toBe(true);
  });

  it("carries every gap sentence verbatim, with no marker inside it", async () => {
    const draft = await result();
    const markdown = draftMarkdown(draft, NOTES);
    const gaps = gapSentences(draft);
    expect(gaps.length).toBeGreaterThan(0);
    for (const sentence of gaps) {
      expect(markdown).toContain(sentence);
    }
  });

  it("prints the failure reason and the skip note under a bodiless heading", async () => {
    const draft = await result({ failSection: "O2", skipSection: "O3" });
    const markdown = draftMarkdown(draft, NOTES);
    expect(markdown).toContain("> failed: timeout");
    expect(markdown).toContain("> skipped");
  });
});

describe("draftExportJson", () => {
  it("is the same object as the Markdown, fingerprint included", async () => {
    const draft = await result({ failSection: "O2" });
    const exported = JSON.parse(draftExportJson(draft)) as DraftResult;
    expect(exported).toEqual(draft);
    expect(exported.run.fingerprint).toBe(draft.run.fingerprint);
    expect(exported.sections.map((section) => section.h2)).toEqual(
      markdownHeadings(draftMarkdown(draft, NOTES)),
    );
  });
});
