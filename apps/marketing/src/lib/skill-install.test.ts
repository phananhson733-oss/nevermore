// @input  -- skillInstallCommand 与真实 skills 内容库
// @output -- 安装命令落点与 URL 形态的回归护栏
// @pos    -- 锁住「命令里的下载 URL 不带 locale 前缀」这条发布约定

import { describe, expect, it } from "vitest";

import { skillInstallCommand } from "./skill-install";
import { SKILL_FILE_NAME, getSkills } from "./skill-content";

describe("skillInstallCommand", () => {
  it("creates the directory the spec requires and saves the file into it", () => {
    const command = skillInstallCommand("seo-audit");

    // The spec identifies a skill by its directory and requires the file
    // inside to be SKILL.md, so both halves have to be in the command a
    // reader pastes — the file alone lands somewhere no agent looks.
    expect(command).toContain("mkdir -p .claude/skills/seo-audit");
    expect(command).toContain(`-o .claude/skills/seo-audit/${SKILL_FILE_NAME}`);
  });

  it("fetches over the prefix-free URL, not the reading locale's", () => {
    const command = skillInstallCommand("seo-audit");

    expect(command).toContain(
      "curl -fsSL https://gengrowth.ai/skills/seo-audit/file",
    );
    // The download is byte-identical on every locale route because SKILL.md is
    // the file an agent loads, not page copy. A locale prefix would only make
    // the pasted command longer. This assertion is what stops the URL drifting
    // back to the reading locale the next time the page is edited.
    expect(command).not.toContain("/zh/");
  });

  it("holds for every published skill", async () => {
    const skills = await getSkills("en");
    expect(skills.length).toBeGreaterThan(0);

    for (const skill of skills) {
      const command = skillInstallCommand(skill.slug);

      expect(command).toContain(`mkdir -p .claude/skills/${skill.slug}`);
      expect(command).toContain(
        `https://gengrowth.ai/skills/${skill.slug}/file`,
      );
      expect(command).not.toMatch(/\/(zh)\//);
    }
  });
});
