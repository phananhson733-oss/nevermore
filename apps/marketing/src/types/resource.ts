// @input  — 无
// @output — Prompt / Skill 资源库的领域类型
// @pos    — 资源库数据类型，对应 content/prompts 与 content/skills 的 Markdown 契约
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

export const PROMPT_CATEGORIES = [
  "research",
  "writing",
  "optimization",
  "geo",
] as const;

export type PromptCategory = (typeof PROMPT_CATEGORIES)[number];

export const SKILL_CATEGORIES = ["seo", "content", "technical", "geo"] as const;

export type SkillCategory = (typeof SKILL_CATEGORIES)[number];

/** Agents that own a skill. Mirrors the live /agents/[slug] routes. */
export const SKILL_OWNERS = ["seo", "tech"] as const;

export type SkillOwner = (typeof SKILL_OWNERS)[number];

/** A `{{placeholder}}` an operator fills in before running a prompt. */
export interface PromptVariable {
  readonly name: string;
  readonly required: boolean;
  readonly description: string;
  readonly example: string;
}

/**
 * A question and its answer. `answer` stays Markdown source so the page can
 * render it and the FAQPage schema can carry a plain-text copy of the same
 * words — the two must never drift apart.
 */
export interface ResourceFaq {
  readonly question: string;
  readonly answer: string;
}

/** One numbered step of a skill's operating loop, mirrored into HowTo schema. */
export interface SkillStep {
  readonly name: string;
  readonly text: string;
}

/** Publication state. Only `published` files are ever served or listed. */
export type ResourceStatus = "draft" | "published";

export interface PromptResource {
  readonly slug: string;
  readonly locale: string;
  readonly title: string;
  readonly description: string;
  readonly category: PromptCategory;
  readonly useCase: string;
  readonly outputFormat: string;
  readonly models: readonly string[];
  readonly keywords: readonly string[];
  /** Slug of the skill that automates this prompt, when one exists. */
  readonly relatedSkill: string | null;
  readonly relatedPrompts: readonly string[];
  /** Verbatim prompt text, copied to the clipboard exactly as stored. */
  readonly promptText: string;
  readonly variables: readonly PromptVariable[];
  readonly howToUse: string;
  readonly exampleInput: string;
  readonly exampleOutput: string;
  readonly safetyNotes: string;
  readonly faqs: readonly ResourceFaq[];
  readonly status: ResourceStatus;
  readonly publishedAt: string;
  readonly updatedAt: string;
}

export interface SkillResource {
  readonly slug: string;
  readonly locale: string;
  readonly title: string;
  readonly description: string;
  /** One-line outcome promise shown under the title on cards and hero. */
  readonly tagline: string;
  readonly category: SkillCategory;
  readonly owner: SkillOwner;
  /** Filename shown on the file window and used by the download route. */
  readonly fileName: string;
  readonly keywords: readonly string[];
  readonly relatedSkills: readonly string[];
  readonly relatedPrompts: readonly string[];
  /** Verbatim SKILL.md contents, served byte-for-byte by the download route. */
  readonly fileContent: string;
  readonly whatItDoes: string;
  readonly exampleAsk: string;
  readonly exampleResponse: string;
  readonly steps: readonly SkillStep[];
  readonly coverage: readonly string[];
  readonly whenToUse: readonly string[];
  readonly faqs: readonly ResourceFaq[];
  readonly status: ResourceStatus;
  readonly publishedAt: string;
  readonly updatedAt: string;
}
