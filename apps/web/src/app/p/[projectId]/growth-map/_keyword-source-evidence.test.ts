import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const component = readFileSync(
  new URL("./_growth-map.tsx", import.meta.url),
  "utf8",
);
const stylesheet = readFileSync(
  new URL("./growth-map.module.css", import.meta.url),
  "utf8",
);
const zh = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../../../packages/i18n/src/messages/zh-CN.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as {
  growthMap: {
    keywordLibrary: {
      sourceKind: Record<string, string>;
      reviewPlatform: Record<string, string>;
    };
  };
};
const en = JSON.parse(
  readFileSync(
    new URL(
      "../../../../../../../packages/i18n/src/messages/en.json",
      import.meta.url,
    ),
    "utf8",
  ),
) as typeof zh;

describe("Growth Map Keyword evidence sources", () => {
  it("labels Product Profile queries independently and renders their FK trace", () => {
    expect(zh.growthMap.keywordLibrary.sourceKind["product_profile"]).toBe(
      "Product Profile 派生查询",
    );
    expect(en.growthMap.keywordLibrary.sourceKind["product_profile"]).toBe(
      "Product Profile-derived query",
    );
    expect(zh.growthMap.keywordLibrary.sourceKind["product_profile"]).not.toBe(
      zh.growthMap.keywordLibrary.sourceKind["manual"],
    );
    expect(component).toContain(
      'occurrence.sourceKind === "product_profile"',
    );
    expect(component).toContain('t("productProfileId")');
    expect(component).toContain("occurrence.productProfileId");
  });

  it("keeps interview summaries and public reviews as distinct Chinese-first source labels", () => {
    const messages = zh.growthMap.keywordLibrary;
    expect(messages.sourceKind["interview_summary"]).toBe("访谈摘要");
    expect(messages.sourceKind["user_review"]).toBe("用户评价");
    expect(messages.sourceKind["interview_summary"]).not.toBe(
      messages.sourceKind["user_review"],
    );
    expect(messages.reviewPlatform).toMatchObject({
      app_store: "App Store",
      g2: "G2",
      capterra: "Capterra",
    });
  });

  it("renders separate visual treatments and bounded evidence details inside the existing Keyword Library", () => {
    expect(component).toContain('data-source-kind={sourceKind}');
    expect(component).toContain(
      'data-source-kind={occurrence.sourceKind}',
    );
    expect(stylesheet).toContain(
      'small[data-source-kind="interview_summary"]',
    );
    expect(stylesheet).toContain(
      'small[data-source-kind="user_review"]',
    );
    expect(component).toContain("occurrence.evidenceLabel");
    expect(component).toContain("occurrence.collectionRunId");
    expect(component).toContain("occurrence.sourceRecordHash");
    expect(component).toContain("occurrence.reviewPlatform");
    expect(component).toContain("occurrence.sourceUrl");
  });

  it("keeps intake-card counts pinned to the loaded range before duplicate rows are folded", () => {
    expect(component).toContain("relationProjection.loadedSourceCounts.all");
    expect(component).toContain(
      "relationProjection.loadedSourceCounts[sourceKind]",
    );
    expect(component).not.toContain(
      "count: relationProjection.visibleItems.length",
    );
  });

  it("does not project raw interview or review-person fields into the customer UI", () => {
    for (const forbidden of [
      "participantName",
      "participantEmail",
      "reviewAuthor",
      "reviewBody",
      "interviewTranscript",
    ]) {
      expect(component).not.toContain(forbidden);
    }
  });
});
