// @input  -- GET from ./route.ts 与真实 skills 内容库
// @output -- 下载端点的边界测试（原文一致、附件头、未知 slug 404）
// @pos    -- Skill 文件下载端点回归护栏
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { describe, expect, it } from "vitest";

import { getSkillsForLocale } from "../../../../../lib/skill-content";
import { GET } from "./route";

function get(locale: string, slug: string) {
  return GET(
    new Request(`https://gengrowth.ai/skills/${slug}/file`),
    { params: Promise.resolve({ locale, slug }) },
  );
}

describe("skill file download", () => {
  it("serves the same bytes the page displays", async () => {
    const { skills } = await getSkillsForLocale("en");
    const skill = skills[0];
    expect(skill).toBeDefined();
    if (!skill) return;

    const response = await get("en", skill.slug);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "text/markdown; charset=utf-8",
    );
    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="${skill.fileName}"`,
    );
    // A download that had drifted from the preview would be the one thing on
    // the page a reader cannot check for themselves. Compared exactly: a test
    // that trims first would pass while the bytes differ.
    expect(await response.text()).toBe(skill.fileContent);
  });

  it("answers 404 for an unknown skill", async () => {
    const response = await get("en", "not-a-real-skill");

    expect(response.status).toBe(404);
  });

  it("answers 404 for a slug that is not a slug", async () => {
    const response = await get("en", "../../etc/passwd");

    expect(response.status).toBe(404);
  });

  it("serves the English file on a locale with no translation", async () => {
    const { skills } = await getSkillsForLocale("en");
    const skill = skills[0];
    expect(skill).toBeDefined();
    if (!skill) return;

    const response = await get("zh", skill.slug);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(skill.fileContent);
  });
});
