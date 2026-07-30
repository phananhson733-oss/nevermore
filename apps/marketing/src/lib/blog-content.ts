// @input  — Node filesystem, zod frontmatter validation, marked, sanitize-html
// @output — validated local Markdown blog posts and sanitized article HTML
// @pos    — canonical repository-backed content source for the marketing blog
import { access, readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { cache } from "react";
import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";
import { z } from "zod";
import type { BlogPost } from "@/types";

export const BLOG_LOCALES = ["en", "zh"] as const;
export type BlogLocale = (typeof BLOG_LOCALES)[number];

const BLOG_CATEGORIES = [
  "case_study",
  "methodology",
  "weekly_review",
  "experiment_log",
] as const;

const BLOG_PILLARS = [
  "growth_automation",
  "experiment_driven",
  "attribution",
  "seo_content",
  "customer_stories",
] as const;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value);
}

function isSafeImageReference(value: string): boolean {
  if (value.startsWith("/")) {
    return !value.startsWith("//") && !value.split("/").includes("..");
  }

  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

const isoDate = z
  .string()
  .regex(DATE_PATTERN)
  .refine(isValidCalendarDate, "must be a real UTC calendar date");

const frontmatterSchema = z
  .object({
    title: z.string().trim().min(1),
    excerpt: z.string().trim().min(1),
    author: z.string().trim().min(1),
    category: z.enum(BLOG_CATEGORIES),
    pillar: z.enum(BLOG_PILLARS).optional(),
    status: z.enum(["draft", "published", "archived"]),
    publishedAt: isoDate,
    updatedAt: isoDate.optional(),
    heroImage: z
      .string()
      .trim()
      .refine(
        isSafeImageReference,
        "must be a root-relative path or an HTTPS URL without path traversal",
      ),
    heroImageAlt: z.string().trim().min(1),
    localeExclusive: z.enum(["true", "false"]).optional(),
  })
  .strict();

type Frontmatter = z.infer<typeof frontmatterSchema>;

interface ParsedMarkdownFile {
  readonly frontmatter: Frontmatter;
  readonly body: string;
}

const marked = new Marked({
  async: false,
  breaks: false,
  gfm: true,
});

const SANITIZE_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "a",
    "blockquote",
    "br",
    "code",
    "del",
    "em",
    "figcaption",
    "figure",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "hr",
    "img",
    "li",
    "ol",
    "p",
    "pre",
    "strong",
    "table",
    "tbody",
    "td",
    "th",
    "thead",
    "tr",
    "ul",
  ],
  allowedAttributes: {
    a: ["href", "title"],
    code: ["class"],
    img: ["src", "alt", "width", "height", "loading"],
    ol: ["start"],
    th: ["colspan", "rowspan"],
    td: ["colspan", "rowspan"],
  },
  allowedSchemes: ["http", "https", "mailto"],
  allowedSchemesByTag: {
    img: ["http", "https"],
  },
  allowProtocolRelative: false,
};

let contentRootPromise: Promise<string> | undefined;

function isBlogLocale(value: string): value is BlogLocale {
  return (BLOG_LOCALES as readonly string[]).includes(value);
}

async function getContentRoot(): Promise<string> {
  contentRootPromise ??= (async () => {
    const candidates = [
      join(process.cwd(), "content", "blog"),
      join(process.cwd(), "apps", "marketing", "content", "blog"),
    ];

    for (const candidate of candidates) {
      try {
        await access(candidate);
        return candidate;
      } catch {
        // The marketing app is invoked from its directory in production, while
        // monorepo-level test commands run from the repository root.
      }
    }

    throw new Error(
      "Marketing blog content directory was not found. Expected content/blog or apps/marketing/content/blog.",
    );
  })();

  return contentRootPromise;
}

function unquoteFrontmatterValue(value: string): string {
  const trimmed = value.trim();
  if (
    trimmed.length >= 2 &&
    ((trimmed.startsWith('"') && trimmed.endsWith('"')) ||
      (trimmed.startsWith("'") && trimmed.endsWith("'")))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/** Parse the deliberately small, scalar-only frontmatter format used by blog files. */
export function parseBlogMarkdown(
  source: string,
  sourceName = "article.md",
): ParsedMarkdownFile {
  if (!source.startsWith("---\n")) {
    throw new Error(`${sourceName}: article must start with YAML-style frontmatter.`);
  }

  const boundary = source.indexOf("\n---\n", 4);
  if (boundary === -1) {
    throw new Error(`${sourceName}: frontmatter closing delimiter is missing.`);
  }

  const rawFrontmatter = source.slice(4, boundary);
  const values: Record<string, string> = {};

  for (const [index, line] of rawFrontmatter.split("\n").entries()) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line);
    if (!match?.[1] || match[2] === undefined) {
      throw new Error(`${sourceName}:${index + 2}: invalid frontmatter line.`);
    }
    if (Object.hasOwn(values, match[1])) {
      throw new Error(`${sourceName}:${index + 2}: duplicate '${match[1]}' field.`);
    }
    values[match[1]] = unquoteFrontmatterValue(match[2]);
  }

  const parsed = frontmatterSchema.safeParse(values);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "frontmatter"}: ${issue.message}`)
      .join("; ");
    throw new Error(`${sourceName}: invalid frontmatter — ${issues}`);
  }

  const body = source.slice(boundary + "\n---\n".length).trim();
  if (!body) throw new Error(`${sourceName}: article body must not be empty.`);

  return { frontmatter: parsed.data, body };
}

/** Render Markdown to an allow-listed HTML subset. Raw HTML never bypasses sanitization. */
export function renderBlogMarkdown(markdown: string): string {
  const rendered = marked.parse(markdown);
  if (typeof rendered !== "string") {
    throw new Error("Expected synchronous Markdown rendering to return HTML.");
  }
  return sanitizeHtml(rendered, SANITIZE_OPTIONS);
}

function calculateReadingTime(markdown: string): number {
  const plainText = markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/!?(?:\[[^\]]*\]\([^)]*\))/g, "")
    .replace(/[`*_>#|~-]/g, " ");
  const words = plainText.trim().split(/\s+/u).filter(Boolean).length;
  const cjkCharacters = (plainText.match(/[\u3400-\u9fff]/gu) ?? []).length;
  return Math.max(1, Math.ceil(words / 200 + cjkCharacters / 400));
}

function toBlogPost(
  locale: BlogLocale,
  filename: string,
  parsed: ParsedMarkdownFile,
): BlogPost {
  const slug = filename.replace(/\.md$/, "");
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `${locale}/${filename}: filename must be a lowercase hyphenated slug ending in .md.`,
    );
  }

  const { frontmatter, body } = parsed;
  const publishedAt = `${frontmatter.publishedAt}T00:00:00.000Z`;
  const updatedAt = frontmatter.updatedAt
    ? `${frontmatter.updatedAt}T00:00:00.000Z`
    : publishedAt;

  return {
    id: `local:${locale}:${slug}`,
    slug,
    title: frontmatter.title,
    content: renderBlogMarkdown(body),
    excerpt: frontmatter.excerpt,
    category: frontmatter.category,
    ...(frontmatter.pillar ? { pillar_slug: frontmatter.pillar } : {}),
    locale,
    // A missing marker must not be interpreted as "this article has no
    // counterpart". Authors opt into exclusivity only with an explicit true.
    locale_exclusive: frontmatter.localeExclusive === "true",
    author: frontmatter.author,
    published_at: publishedAt,
    updated_at: updatedAt,
    reading_time: calculateReadingTime(body),
    status: frontmatter.status,
    created_at: publishedAt,
    hero_image: frontmatter.heroImage,
    hero_image_alt: frontmatter.heroImageAlt,
    content_source: "local",
  };
}

async function readPostsForLocale(locale: BlogLocale): Promise<readonly BlogPost[]> {
  const root = await getContentRoot();
  const directory = join(root, locale);
  const filenames = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));

  const posts = await Promise.all(
    filenames.map(async (filename) => {
      const source = await readFile(join(directory, filename), "utf8");
      return toBlogPost(locale, filename, parseBlogMarkdown(source, `${locale}/${filename}`));
    }),
  );

  return posts;
}

const getAllLocalPosts = cache(async (): Promise<readonly BlogPost[]> => {
  const perLocale = await Promise.all(BLOG_LOCALES.map(readPostsForLocale));
  return perLocale
    .flat()
    .filter((post) => post.status === "published")
    .sort(
      (left, right) =>
        new Date(right.published_at).getTime() -
        new Date(left.published_at).getTime(),
    );
});

export async function getLocalBlogPosts(locale?: string): Promise<readonly BlogPost[]> {
  const posts = await getAllLocalPosts();
  return locale && isBlogLocale(locale)
    ? posts.filter((post) => post.locale === locale)
    : posts;
}

export async function getLocalBlogPostBySlug(
  slug: string,
  locale: string,
): Promise<BlogPost | null> {
  if (!isBlogLocale(locale) || !SLUG_PATTERN.test(slug)) return null;
  const posts = await getLocalBlogPosts(locale);
  return posts.find((post) => post.slug === slug) ?? null;
}
