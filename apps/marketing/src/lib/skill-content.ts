// @input  — Node filesystem, zod frontmatter validation, resource-markdown 分节工具
// @output — 校验后的 Skill 资源与按 slug / 分类 / owner agent 的查询
// @pos    — /skills 资源库的仓库内容源（repository-backed，唯一权威）
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
  parseBulletList,
  parseResourceFrontmatter,
  unquoteScalar,
  requireSection,
  splitResourceSections,
  splitResourceSubsections,
} from "./resource-markdown";
import {
  DEFAULT_CONTENT_LOCALE,
  RESOURCE_LOCALES,
  type ResourceLocale,
} from "./prompt-content";
import {
  SKILL_CATEGORIES,
  SKILL_OWNERS,
  type ResourceFaq,
  type SkillResource,
  type SkillStep,
} from "../types/resource";

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The Agent Skills spec fixes both halves of where a skill lives: the file is
 * always `SKILL.md`, and the directory holding it must match the `name` in its
 * frontmatter. Both are derived from the slug here rather than declared per
 * file, because the download is only useful if it lands somewhere an agent
 * looks — a per-skill filename is a chance to get that wrong and no chance to
 * get it more right.
 *
 * @see https://agentskills.io/specification
 */
export const SKILL_FILE_NAME = "SKILL.md";
const SKILL_INSTALL_ROOT = ".claude/skills";

/** Where a downloaded skill file has to be saved for an agent to load it. */
export function skillInstallPath(slug: string): string {
  return `${SKILL_INSTALL_ROOT}/${slug}/${SKILL_FILE_NAME}`;
}

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

const commaList = z
  .string()
  .trim()
  .min(1)
  .transform((value) => value.split(",").map((entry) => entry.trim()))
  .refine(
    (entries) => entries.every((entry) => entry.length > 0),
    "must not contain empty entries",
  )
  // These lists are sets: every one of them becomes a React key or a rendered
  // link, so a repeat produces the same card twice under one key.
  .refine((entries) => new Set(entries).size === entries.length, {
    message: "must not repeat an entry",
  });

const slugList = commaList.refine(
  (entries) => entries.every((entry) => SLUG_PATTERN.test(entry)),
  "must be lowercase hyphenated slugs",
);

const frontmatterSchema = z
  .object({
    title: z.string().trim().min(1),
    description: z.string().trim().min(1),
    tagline: z.string().trim().min(1),
    category: z.enum(SKILL_CATEGORIES),
    owner: z.enum(SKILL_OWNERS),
    keywords: commaList,
    relatedSkills: slugList.optional(),
    relatedPrompts: slugList.optional(),
    status: z.enum(["draft", "published"]),
    publishedAt: isoDate,
    updatedAt: isoDate.optional(),
  })
  .strict();

const SECTION_FILE = "Skill file";
const SECTION_WHAT_IT_DOES = "What it does";
const SECTION_IN_ACTION = "In action";
const SECTION_HOW_IT_WORKS = "How it works";
const SECTION_COVERAGE = "What it covers";
const SECTION_WHEN_TO_USE = "When to use it";
const SECTION_FAQ = "FAQ";

const SUBSECTION_ASK = "You ask";
const SUBSECTION_RESPONSE = "The agent does";

let contentRootPromise: Promise<string> | undefined;

function isResourceLocale(value: string): value is ResourceLocale {
  return (RESOURCE_LOCALES as readonly string[]).includes(value);
}

async function getContentRoot(): Promise<string> {
  contentRootPromise ??= (async () => {
    const candidates = [
      join(process.cwd(), "content", "skills"),
      join(process.cwd(), "apps", "marketing", "content", "skills"),
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
      "Skill content directory was not found. Expected content/skills or apps/marketing/content/skills.",
    );
  })();

  return contentRootPromise;
}

/**
 * Frontmatter keys the Agent Skills spec defines. Anything else at the top
 * level is rejected rather than ignored: a reader who downloads this file is
 * told it is spec-compliant, and an unknown key is the one kind of defect that
 * still parses, still renders, and only shows up in whichever agent is strict.
 * Client-specific values belong under `metadata`, which the spec reserves for
 * exactly that.
 *
 * @see https://agentskills.io/specification
 */
const SPEC_FRONTMATTER_KEYS = new Set([
  "name",
  "description",
  "license",
  "compatibility",
  "metadata",
  "allowed-tools",
]);

const SKILL_NAME_MAX = 64;
const SKILL_DESCRIPTION_MAX = 1024;

/**
 * A skill file is a real SKILL.md: spec frontmatter, then plain-language
 * instructions. The checks here are the spec's own constraints, applied at
 * build time — the file is offered as something to drop into an agent, so the
 * cost of publishing one that fails validation lands on the reader, who has no
 * way to tell the difference before it silently fails to load.
 */
function assertSkillFileShape(
  fileContent: string,
  slug: string,
  sourceName: string,
): void {
  if (!fileContent.startsWith("---\n")) {
    throw new Error(
      `${sourceName}: the skill file must open with its own YAML frontmatter.`,
    );
  }
  const boundary = fileContent.indexOf("\n---\n", 4);
  if (boundary === -1) {
    throw new Error(
      `${sourceName}: the skill file's frontmatter is not closed.`,
    );
  }

  const header = fileContent.slice(4, boundary);
  for (const field of ["name", "description"] as const) {
    if (!new RegExp(`^${field}:\\s*\\S`, "m").test(header)) {
      throw new Error(
        `${sourceName}: the skill file's frontmatter must set '${field}'.`,
      );
    }
  }

  // Top-level keys start at column zero; anything indented belongs to the
  // mapping above it, which is how `metadata:` carries its own keys legally.
  for (const line of header.split("\n")) {
    if (!line.trim() || /^\s/.test(line)) continue;
    const key = /^([^:\s]+):/.exec(line)?.[1];
    if (key && !SPEC_FRONTMATTER_KEYS.has(key)) {
      throw new Error(
        `${sourceName}: the skill file sets '${key}', which the Agent Skills spec does not define. Put client-specific values under 'metadata:'.`,
      );
    }
  }

  // Unquoted, because quoting a scalar is ordinary YAML and the file is meant
  // to be usable outside this site.
  const rawName = /^name:\s*(.+?)\s*$/m.exec(header)?.[1];
  const declaredName = rawName ? unquoteScalar(rawName) : undefined;
  if (declaredName && declaredName !== slug) {
    throw new Error(
      `${sourceName}: the skill file declares name '${declaredName}' but lives at '${slug}.md'. The spec requires the name to match the directory the file is installed into.`,
    );
  }
  if (declaredName && declaredName.length > SKILL_NAME_MAX) {
    throw new Error(
      `${sourceName}: the skill file's name is ${declaredName.length} characters; the spec allows ${SKILL_NAME_MAX}.`,
    );
  }

  // Single-line only: every description here is one line, and a folded scalar
  // measured by its first line would pass a limit the whole value breaks.
  const rawDescription = /^description:\s*(.+?)\s*$/m.exec(header)?.[1];
  const description = rawDescription
    ? unquoteScalar(rawDescription)
    : undefined;
  if (description && description.length > SKILL_DESCRIPTION_MAX) {
    throw new Error(
      `${sourceName}: the skill file's description is ${description.length} characters; the spec allows ${SKILL_DESCRIPTION_MAX}.`,
    );
  }
}

function parseSteps(section: string, sourceName: string): readonly SkillStep[] {
  const subsections = splitResourceSubsections(
    section,
    sourceName,
    SECTION_HOW_IT_WORKS,
  );
  if (subsections.length < 2) {
    throw new Error(
      `${sourceName}: '${SECTION_HOW_IT_WORKS}' must describe at least two steps.`,
    );
  }

  return subsections.map((subsection) => {
    const text = subsection.content.trim();
    if (!text) {
      throw new Error(
        `${sourceName}: step '${subsection.heading}' has no description.`,
      );
    }
    return { name: subsection.heading.trim(), text };
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

function parseInAction(
  section: string,
  sourceName: string,
): { readonly ask: string; readonly response: string } {
  const subsections = splitResourceSubsections(
    section,
    sourceName,
    SECTION_IN_ACTION,
  );
  const ask = subsections.find(
    (subsection) => subsection.heading.trim() === SUBSECTION_ASK,
  );
  const response = subsections.find(
    (subsection) => subsection.heading.trim() === SUBSECTION_RESPONSE,
  );

  if (!ask?.content.trim() || !response?.content.trim()) {
    throw new Error(
      `${sourceName}: '${SECTION_IN_ACTION}' needs both '### ${SUBSECTION_ASK}' and '### ${SUBSECTION_RESPONSE}'.`,
    );
  }

  return { ask: ask.content.trim(), response: response.content.trim() };
}

function toSkillResource(
  locale: ResourceLocale,
  filename: string,
  source: string,
): SkillResource {
  const sourceName = `skills/${locale}/${filename}`;
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
  const fileContent = extractFencedBlock(
    requireSection(sections, SECTION_FILE, sourceName),
    sourceName,
    SECTION_FILE,
  );
  assertSkillFileShape(fileContent, slug, sourceName);

  const inAction = parseInAction(
    requireSection(sections, SECTION_IN_ACTION, sourceName),
    sourceName,
  );

  const publishedAt = `${frontmatter.publishedAt}T00:00:00.000Z`;

  return {
    slug,
    locale,
    title: frontmatter.title,
    description: frontmatter.description,
    tagline: frontmatter.tagline,
    category: frontmatter.category,
    owner: frontmatter.owner,
    installPath: skillInstallPath(slug),
    keywords: frontmatter.keywords,
    relatedSkills: frontmatter.relatedSkills ?? [],
    relatedPrompts: frontmatter.relatedPrompts ?? [],
    fileContent,
    whatItDoes: requireSection(sections, SECTION_WHAT_IT_DOES, sourceName),
    exampleAsk: inAction.ask,
    exampleResponse: inAction.response,
    steps: parseSteps(
      requireSection(sections, SECTION_HOW_IT_WORKS, sourceName),
      sourceName,
    ),
    coverage: parseBulletList(
      requireSection(sections, SECTION_COVERAGE, sourceName),
      sourceName,
      SECTION_COVERAGE,
    ),
    whenToUse: parseBulletList(
      requireSection(sections, SECTION_WHEN_TO_USE, sourceName),
      sourceName,
      SECTION_WHEN_TO_USE,
    ),
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
export function parseSkillFile(
  locale: ResourceLocale,
  filename: string,
  source: string,
): SkillResource {
  return toSkillResource(locale, filename, source);
}

async function readSkillsForLocale(
  locale: ResourceLocale,
): Promise<readonly SkillResource[]> {
  const root = await getContentRoot();
  const directory = join(root, locale);

  let filenames: readonly string[];
  try {
    filenames = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    // Only "this locale has no directory yet" is a real state. Any other fault
    // — a permission error, too many open files — must not be reported as an
    // empty library: downstream, empty is legitimate, so a transient IO failure
    // would 404 every published URL and silently empty the sitemap.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // A locale with no library yet is a real state, not a build failure.
    return [];
  }

  return Promise.all(
    filenames.map(async (filename) => {
      const source = await readFile(join(directory, filename), "utf8");
      return toSkillResource(locale, filename, source);
    }),
  );
}

function assertRelatedSkillsResolve(skills: readonly SkillResource[]): void {
  const byLocale = new Map<string, Set<string>>();
  for (const skill of skills) {
    const slugs = byLocale.get(skill.locale) ?? new Set<string>();
    slugs.add(skill.slug);
    byLocale.set(skill.locale, slugs);
  }
  const defaultSlugs =
    byLocale.get(DEFAULT_CONTENT_LOCALE) ?? new Set<string>();

  for (const skill of skills) {
    const own = byLocale.get(skill.locale) ?? new Set<string>();
    // A translated file may legitimately point at a slug only the default
    // locale owns: the reader resolves it through the same per-slug fallback
    // the page uses. Validating against the locale's own files alone would
    // reject the first translation anyone writes.
    const resolvable =
      skill.locale === DEFAULT_CONTENT_LOCALE
        ? own
        : new Set([...own, ...defaultSlugs]);

    for (const related of skill.relatedSkills) {
      if (related === skill.slug) {
        throw new Error(
          `skills/${skill.locale}/${skill.slug}.md: relatedSkills must not link to itself.`,
        );
      }
      if (!resolvable.has(related)) {
        throw new Error(
          `skills/${skill.locale}/${skill.slug}.md: relatedSkills references unknown skill '${related}'.`,
        );
      }
    }
  }
}

const getAllSkillsCached = cache(
  async (): Promise<readonly SkillResource[]> => {
    const perLocale = await Promise.all(
      RESOURCE_LOCALES.map(readSkillsForLocale),
    );
    // Drafts are dropped before anything downstream sees them, so an unfinished
    // file cannot reach a page, a sitemap entry, or a related-links list.
    const skills = perLocale
      .flat()
      .filter((skill) => skill.status === "published")
      .sort((left, right) => left.title.localeCompare(right.title));
    // Validated after the filter, so a published skill pointing at a draft is
    // caught as the dead link it would become.
    assertRelatedSkillsResolve(skills);
    return skills;
  },
);

export async function getSkills(
  locale?: string,
): Promise<readonly SkillResource[]> {
  const skills = await getAllSkillsCached();
  return locale && isResourceLocale(locale)
    ? skills.filter((skill) => skill.locale === locale)
    : skills;
}

export async function getSkillBySlug(
  slug: string,
  locale: string,
): Promise<SkillResource | null> {
  if (!isResourceLocale(locale) || !SLUG_PATTERN.test(slug)) return null;
  const skills = await getSkills(locale);
  return skills.find((skill) => skill.slug === slug) ?? null;
}

export interface SkillCollection {
  readonly skills: readonly SkillResource[];
  /** True when at least one entry is being served from the English library. */
  readonly hasFallback: boolean;
}

/**
 * Resolve the library for a route, filling gaps from English per entry — the
 * same contract the prompt library uses, so partial translation behaves the
 * same way in both.
 */
export async function getSkillsForLocale(
  locale: string,
): Promise<SkillCollection> {
  const requested: ResourceLocale = isResourceLocale(locale) ? locale : "en";
  const english = await getSkills("en");
  if (requested === "en") {
    return { skills: english, hasFallback: false };
  }

  const translated = await getSkills(requested);
  const bySlug = new Map(translated.map((skill) => [skill.slug, skill]));
  const merged = english.map((skill) => bySlug.get(skill.slug) ?? skill);
  const englishSlugs = new Set(english.map((skill) => skill.slug));
  const exclusive = translated.filter((skill) => !englishSlugs.has(skill.slug));

  return {
    skills: [...merged, ...exclusive].sort((left, right) =>
      left.title.localeCompare(right.title),
    ),
    hasFallback: merged.some((skill) => skill.locale !== requested),
  };
}

/** Resolve one skill for a route, falling back to English the same way. */
export async function getSkillForLocale(
  slug: string,
  locale: string,
): Promise<SkillResource | null> {
  const { skills } = await getSkillsForLocale(locale);
  return skills.find((skill) => skill.slug === slug) ?? null;
}

/**
 * The locales that have their own file for this slug.
 *
 * Drives hreflang: a locale serving another locale's text through the fallback
 * must not announce itself as that language's version of the page.
 */
export async function localesOwningSkill(
  slug: string,
): Promise<readonly string[]> {
  const owned = await Promise.all(
    RESOURCE_LOCALES.map(async (locale) => ({
      locale,
      owns: (await getSkills(locale)).some((entry) => entry.slug === slug),
    })),
  );
  return owned.filter((entry) => entry.owns).map((entry) => entry.locale);
}
