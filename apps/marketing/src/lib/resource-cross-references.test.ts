// @input  -- 两个资源库的已发布内容
// @output -- 跨库引用（prompt→skill、skill→prompt）解析护栏
// @pos    -- 运行时只校验同库引用；跨库引用失效是静默的，只有这里能抓到

import { describe, expect, it } from "vitest";

import { getPrompts } from "./prompt-content";
import { getSkills } from "./skill-content";

/**
 * A dangling same-library reference throws in the loader. A dangling
 * cross-library one does not: the detail page simply renders nothing where the
 * link should be, so the page looks finished and the link is just gone. The two
 * loaders cannot check each other without importing each other, so the contract
 * is enforced here instead.
 */
describe("cross-library references", () => {
  it("resolves every relatedSkill a prompt points at", async () => {
    const [prompts, skills] = await Promise.all([
      getPrompts("en"),
      getSkills("en"),
    ]);
    const skillSlugs = new Set(skills.map((skill) => skill.slug));

    const dangling = prompts
      .filter((prompt) => prompt.relatedSkill)
      .filter((prompt) => !skillSlugs.has(prompt.relatedSkill as string))
      .map((prompt) => `${prompt.slug} -> ${prompt.relatedSkill}`);

    expect(dangling).toEqual([]);
  });

  it("resolves every relatedPrompt a skill points at", async () => {
    const [prompts, skills] = await Promise.all([
      getPrompts("en"),
      getSkills("en"),
    ]);
    const promptSlugs = new Set(prompts.map((prompt) => prompt.slug));

    const dangling = skills.flatMap((skill) =>
      skill.relatedPrompts
        .filter((slug) => !promptSlugs.has(slug))
        .map((slug) => `${skill.slug} -> ${slug}`),
    );

    expect(dangling).toEqual([]);
  });

  it("gives every prompt somewhere to go next", async () => {
    const prompts = await getPrompts("en");

    // A detail page tops its related list up from the same category, so this
    // only fails if a category holds a single prompt with no explicit links.
    for (const prompt of prompts) {
      const sameCategory = prompts.filter(
        (other) =>
          other.category === prompt.category && other.slug !== prompt.slug,
      );
      expect(prompt.relatedPrompts.length + sameCategory.length).toBeGreaterThan(
        0,
      );
    }
  });
});
