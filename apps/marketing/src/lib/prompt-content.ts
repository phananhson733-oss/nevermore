// @input  — Node filesystem, zod frontmatter validation, resource-markdown 分节工具
// @output — 校验后的 Prompt 资源与按 slug / 分类的查询
// @pos    — /prompts 资源库的仓库内容源（repository-backed，唯一权威）
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { cache } from "react";
import { z } from "zod";
// Relative imports, not the `@/` alias: the shared Vitest config maps `@/` to
// apps/web only, so an aliased import here would not resolve in the tests that
// exercise this loader directly.
import {
  extractFencedBlock,
  parseResourceFrontmatter,
  requireSection,
  splitResourceSections,
  splitResourceSubsections,
} from "./resource-markdown";
import {
  PROMPT_CATEGORIES,
  type PromptResource,
  type PromptVariable,
  type ResourceFaq,
} from "../types/resource";

export const RESOURCE_LOCALES = ["en", "zh"] as const;
export type ResourceLocale = (typeof RESOURCE_LOCALES)[number];

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const VARIABLE_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;
/**
 * Matches any `{{…}}` run, not only well-formed names.
 *
 * A pattern that only recognised valid snake_case would make a malformed
 * placeholder — `{{SiteTopic}}`, `{{site-topic}}` — invisible to the
 * cross-check, so it would ship undocumented in the copyable prompt while the
 * variable cards looked complete.
 */
const PLACEHOLDER_PATTERN = /\{\{([^{}]*)\}\}/g;

/** Models a prompt may be labelled as tested against. */
const KNOWN_MODELS = ["ChatGPT", "Claude", "Gemini", "DeepSeek"] as const;

function isValidCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

const isoDate = z
  .string()
  .regex(DATE_PATTERN)
  .refine(isValidCalendarDate, "must be a real UTC calendar date");

/** Split a comma-separated frontmatter list, rejecting blank entries. */
const commaList = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.split(",").map((entry) => entry.trim()))
  .refine(
    (entries) => entries.every((entry) => entry.length > 0),
    "must not contain empty entries",
  );

const slugList = commaList.refine(
  (entries) => entries.every((entry) => SLUG_PATTERN.test(entry)),
  "must be lowercase hyphenated slugs",
);

const frontmatterSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    category: z.enum(PROMPT_CATEGORIES),
    useCase: z.string().trim().min(1),
    outputFormat: z.string().trim().min(1),
    models: commaList.refine(
      (entries) =>
        entries.every((entry) =>
          (KNOWN_MODELS as readonly string[]).includes(entry),
        ),
      `must list only ${KNOWN_MODELS.join(", ")}`,
    ),
    keywords: commaList,
    relatedSkill: z
      .string()
      .trim()
      .regex(SLUG_PATTERN, "must be a lowercase hyphenated slug")
      .optional(),
    relatedPrompts: slugList.optional(),
    status: z.enum(["draft", "published"]),
    publishedAt: isoDate,
    updatedAt: isoDate.optional(),
  })
  .strict();

const SECTION_PROMPT = "Prompt";
const SECTION_VARIABLES = "Variables";
const SECTION_HOW_TO_USE = "How to use";
const SECTION_EXAMPLE_INPUT = "Example input";
const SECTION_EXAMPLE_OUTPUT = "Example output";
const SECTION_SAFETY = "Safety notes";
const SECTION_FAQ = "FAQ";

let contentRootPromise: Promise<string> | undefined;

function isResourceLocale(value: string): value is ResourceLocale {
  return (RESOURCE_LOCALES as readonly string[]).includes(value);
}

async function getContentRoot(): Promise<string> {
  contentRootPromise ??= (async () => {
    const candidates = [
      join(process.cwd(), "content", "prompts"),
      join(process.cwd(), "apps", "marketing", "content", "prompts"),
    ];

    for (const candidate of candidates) {
      try {
        await access(candidate);
        return candidate;
      } catch {
        // The marketing app runs from its own directory in production while
        // repository-level test commands run from the monorepo root.
      }
    }

    throw new Error(
      "Prompt content directory was not found. Expected content/prompts or apps/marketing/content/prompts.",
    );
  })();

  return contentRootPromise;
}

/**
 * Parse the `### variable_name` cards.
 *
 * Each card states whether the placeholder is required and shows one concrete
 * example — a prompt whose variables are only described inside the prompt text
 * is the failure this section exists to prevent.
 */
function parseVariables(
  section: string,
  sourceName: string,
): readonly PromptVariable[] {
  const subsections = splitResourceSubsections(
    section,
    sourceName,
    SECTION_VARIABLES,
  );
  if (subsections.length === 0) {
    throw new Error(
      `${sourceName}: '${SECTION_VARIABLES}' must describe at least one variable.`,
    );
  }

  return subsections.map((subsection) => {
    const name = subsection.heading.trim();
    if (!VARIABLE_NAME_PATTERN.test(name)) {
      throw new Error(
        `${sourceName}: variable '${name}' must be snake_case starting with a letter.`,
      );
    }

    const lines = subsection.content
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);

    const exampleLine = lines.find((line) => line.startsWith("Example:"));
    if (!exampleLine) {
      throw new Error(
        `${sourceName}: variable '${name}' must carry an 'Example:' line.`,
      );
    }
    const example = exampleLine.slice("Example:".length).trim();
    if (!example) {
      throw new Error(
        `${sourceName}: variable '${name}' has an empty example.`,
      );
    }

    const descriptionLines = lines.filter((line) => line !== exampleLine);
    const rawDescription = descriptionLines.join(" ").trim();
    const required = rawDescription.startsWith("Required.");
    const optional = rawDescription.startsWith("Optional.");
    if (!required && !optional) {
      throw new Error(
        `${sourceName}: variable '${name}' must start with 'Required.' or 'Optional.'.`,
      );
    }

    const description = rawDescription
      .slice(required ? "Required.".length : "Optional.".length)
      .trim();
    if (!description) {
      throw new Error(
        `${sourceName}: variable '${name}' must describe what to put in it.`,
      );
    }

    return { name, required, description, example };
  });
}

function parseFaqs(
  section: string,
  sourceName: string,
): readonly ResourceFaq[] {
  const subsections = splitResourceSubsections(
    section,
    sourceName,
    SECTION_FAQ,
  );
  if (subsections.length < 2) {
    throw new Error(
      `${sourceName}: '${SECTION_FAQ}' must answer at least two questions.`,
    );
  }

  return subsections.map((subsection) => {
    const question = subsection.heading.trim();
    const answer = subsection.content.trim();
    if (!answer) {
      throw new Error(`${sourceName}: FAQ '${question}' has no answer.`);
    }
    return { question, answer };
  });
}

/**
 * Cross-check placeholders against variable cards in both directions.
 *
 * A prompt is shipped as two artifacts that must agree: the text an operator
 * copies and the cards telling them what to fill in. Checking one direction
 * only would let an undocumented placeholder reach the page.
 */
function assertPlaceholdersMatchVariables(
  promptText: string,
  variables: readonly PromptVariable[],
  sourceName: string,
): void {
  const raw = [...promptText.matchAll(PLACEHOLDER_PATTERN)].map(
    (match) => match[1] ?? "",
  );

  // Reject a malformed placeholder outright. Skipping it would let it through
  // undocumented, and silently correcting it would change the text an operator
  // copies without changing the file it came from.
  const malformed = raw
    .map((name) => name.trim())
    .filter((name) => !VARIABLE_NAME_PATTERN.test(name));
  if (malformed.length > 0) {
    throw new Error(
      `${sourceName}: placeholders must be snake_case starting with a letter: ${[
        ...new Set(malformed),
      ]
        .sort()
        .map((name) => `{{${name}}}`)
        .join(", ")}.`,
    );
  }

  const placeholders = new Set(raw.map((name) => name.trim()));
  const documented = new Set(variables.map((variable) => variable.name));

  const undocumented = [...placeholders].filter(
    (name) => !documented.has(name),
  );
  if (undocumented.length > 0) {
    throw new Error(
      `${sourceName}: prompt uses undocumented placeholders: ${undocumented.sort().join(", ")}.`,
    );
  }

  const unused = [...documented].filter((name) => !placeholders.has(name));
  if (unused.length > 0) {
    throw new Error(
      `${sourceName}: variables documented but absent from the prompt: ${unused.sort().join(", ")}.`,
    );
  }
}

function toPromptResource(
  locale: ResourceLocale,
  filename: string,
  source: string,
): PromptResource {
  const sourceName = `prompts/${locale}/${filename}`;
  const slug = filename.replace(/\.md$/, "");
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `${sourceName}: filename must be a lowercase hyphenated slug ending in .md.`,
    );
  }

  const { values, body } = parseResourceFrontmatter(source, sourceName);
  const parsed = frontmatterSchema.safeParse(values);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map(
        (issue) => `${issue.path.join(".") || "frontmatter"}: ${issue.message}`,
      )
      .join("; ");
    throw new Error(`${sourceName}: invalid frontmatter — ${issues}`);
  }
  const frontmatter = parsed.data;

  const sections = splitResourceSections(body, sourceName);
  const promptText = extractFencedBlock(
    requireSection(sections, SECTION_PROMPT, sourceName),
    sourceName,
    SECTION_PROMPT,
  );
  const variables = parseVariables(
    requireSection(sections, SECTION_VARIABLES, sourceName),
    sourceName,
  );
  assertPlaceholdersMatchVariables(promptText, variables, sourceName);

  const exampleInput = extractFencedBlock(
    requireSection(sections, SECTION_EXAMPLE_INPUT, sourceName),
    sourceName,
    SECTION_EXAMPLE_INPUT,
  );

  const publishedAt = `${frontmatter.publishedAt}T00:00:00.000Z`;

  return {
    slug,
    locale,
    title: frontmatter.title,
    description: frontmatter.description,
    category: frontmatter.category,
    useCase: frontmatter.useCase,
    outputFormat: frontmatter.outputFormat,
    models: frontmatter.models,
    keywords: frontmatter.keywords,
    relatedSkill: frontmatter.relatedSkill ?? null,
    relatedPrompts: frontmatter.relatedPrompts ?? [],
    promptText,
    variables,
    howToUse: requireSection(sections, SECTION_HOW_TO_USE, sourceName),
    exampleInput,
    exampleOutput: requireSection(sections, SECTION_EXAMPLE_OUTPUT, sourceName),
    safetyNotes: requireSection(sections, SECTION_SAFETY, sourceName),
    faqs: parseFaqs(
      requireSection(sections, SECTION_FAQ, sourceName),
      sourceName,
    ),
    status: frontmatter.status,
    publishedAt,
    updatedAt: frontmatter.updatedAt
      ? `${frontmatter.updatedAt}T00:00:00.000Z`
      : publishedAt,
  };
}

/** Exposed for tests: parse one file's source without touching the filesystem. */
export function parsePromptFile(
  locale: ResourceLocale,
  filename: string,
  source: string,
): PromptResource {
  return toPromptResource(locale, filename, source);
}

async function readPromptsForLocale(
  locale: ResourceLocale,
): Promise<readonly PromptResource[]> {
  const root = await getContentRoot();
  const directory = join(root, locale);

  let filenames: readonly string[];
  try {
    filenames = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch {
    // A locale with no library yet is a real state, not a build failure: the
    // detail route only claims an alternate when that locale's file exists.
    return [];
  }

  return Promise.all(
    filenames.map(async (filename) => {
      const source = await readFile(join(directory, filename), "utf8");
      return toPromptResource(locale, filename, source);
    }),
  );
}

/**
 * Reject cross-references that point at nothing.
 *
 * Related links are the library's internal link mesh; a stale slug there is a
 * dead link on a page whose whole job is to send readers somewhere useful.
 */
function assertRelatedPromptsResolve(prompts: readonly PromptResource[]): void {
  const byLocale = new Map<string, Set<string>>();
  for (const prompt of prompts) {
    const slugs = byLocale.get(prompt.locale) ?? new Set<string>();
    slugs.add(prompt.slug);
    byLocale.set(prompt.locale, slugs);
  }

  for (const prompt of prompts) {
    const known = byLocale.get(prompt.locale) ?? new Set<string>();
    for (const related of prompt.relatedPrompts) {
      if (related === prompt.slug) {
        throw new Error(
          `prompts/${prompt.locale}/${prompt.slug}.md: relatedPrompts must not link to itself.`,
        );
      }
      if (!known.has(related)) {
        throw new Error(
          `prompts/${prompt.locale}/${prompt.slug}.md: relatedPrompts references unknown prompt '${related}'.`,
        );
      }
    }
  }
}

const getAllPromptsCached = cache(
  async (): Promise<readonly PromptResource[]> => {
    const perLocale = await Promise.all(
      RESOURCE_LOCALES.map(readPromptsForLocale),
    );
    // Drafts are dropped before anything downstream sees them, so an unfinished
    // file cannot reach a page, a sitemap entry, or a related-links list.
    const prompts = perLocale
      .flat()
      .filter((prompt) => prompt.status === "published")
      .sort((left, right) => left.title.localeCompare(right.title));
    // Validated after the filter, so a published prompt pointing at a draft is
    // caught as the dead link it would become.
    assertRelatedPromptsResolve(prompts);
    return prompts;
  },
);

export async function getPrompts(
  locale?: string,
): Promise<readonly PromptResource[]> {
  const prompts = await getAllPromptsCached();
  return locale && isResourceLocale(locale)
    ? prompts.filter((prompt) => prompt.locale === locale)
    : prompts;
}

export async function getPromptBySlug(
  slug: string,
  locale: string,
): Promise<PromptResource | null> {
  if (!isResourceLocale(locale) || !SLUG_PATTERN.test(slug)) return null;
  const prompts = await getPrompts(locale);
  return prompts.find((prompt) => prompt.slug === slug) ?? null;
}

export interface PromptCollection {
  readonly prompts: readonly PromptResource[];
  /** True when at least one entry is being served from the English library. */
  readonly hasFallback: boolean;
}

/**
 * Resolve the library for a route, filling gaps from English per entry.
 *
 * Merging one slug at a time rather than choosing a whole library is what makes
 * partial translation safe: the first translated file would otherwise shrink
 * the locale's library to that single entry, leaving every other slug a 404
 * behind an hreflang tag still promising it exists. Each entry keeps its own
 * `locale`, so a page can say which of the two it is showing.
 */
export async function getPromptsForLocale(
  locale: string,
): Promise<PromptCollection> {
  const requested: ResourceLocale = isResourceLocale(locale) ? locale : "en";
  const english = await getPrompts("en");
  if (requested === "en") {
    return { prompts: english, hasFallback: false };
  }

  const translated = await getPrompts(requested);
  const bySlug = new Map(translated.map((prompt) => [prompt.slug, prompt]));
  const merged = english.map((prompt) => bySlug.get(prompt.slug) ?? prompt);
  // A prompt written only in this locale still belongs in its library.
  const englishSlugs = new Set(english.map((prompt) => prompt.slug));
  const exclusive = translated.filter(
    (prompt) => !englishSlugs.has(prompt.slug),
  );

  return {
    prompts: [...merged, ...exclusive].sort((left, right) =>
      left.title.localeCompare(right.title),
    ),
    hasFallback: merged.some((prompt) => prompt.locale !== requested),
  };
}

/** Resolve one prompt for a route, falling back to English the same way. */
export async function getPromptForLocale(
  slug: string,
  locale: string,
): Promise<PromptResource | null> {
  const { prompts } = await getPromptsForLocale(locale);
  return prompts.find((prompt) => prompt.slug === slug) ?? null;
}
