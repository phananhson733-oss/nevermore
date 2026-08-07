// @input  — content/legal/{locale}/{docType}.md，zod frontmatter 校验
// @output — 仓库内的法务文档，契约与原 Supabase 版本一致
// @pos    — 法务数据层的真实来源，取代已不可访问的 legacy Supabase 表
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { cache } from "react";
import { z } from "zod";

// Relative, not `@/`: the Vitest alias table maps `@/` to apps/web/src only, so
// a marketing module reached through it from a unit test resolves into the web
// app. See the note at the top of vitest.config.ts.
import type { LegalDocument } from "../types";

export const LEGAL_DOC_TYPES = [
  "privacy",
  "terms",
  "cookies",
  "copyright",
] as const;
export type LegalDocType = (typeof LEGAL_DOC_TYPES)[number];

export const LEGAL_LOCALES = ["en", "zh"] as const;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isValidCalendarDate(value: string): boolean {
  if (!DATE_PATTERN.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(value)
  );
}

/**
 * `status` is the review gate, and it is the point of this field.
 *
 * These documents carry legal consequences, so a draft that happens to be
 * merged must not thereby become the published policy. A draft renders the
 * page's existing "coming soon" state — identical to having no document at all
 * — until someone deliberately flips one word.
 */
const frontmatterSchema = z.object({
  title: z.string().trim().min(1),
  version: z.string().trim().min(1),
  effectiveDate: z
    .string()
    .regex(DATE_PATTERN)
    .refine(isValidCalendarDate, "must be a real UTC calendar date"),
  status: z.enum(["draft", "published"]),
});

function unquote(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length >= 2) {
    const first = trimmed[0];
    const last = trimmed[trimmed.length - 1];
    if ((first === '"' || first === "'") && first === last) {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

/** Same deliberately small, scalar-only frontmatter format the blog files use. */
export function parseLegalMarkdown(
  source: string,
  sourceName = "document.md",
): {
  readonly frontmatter: z.infer<typeof frontmatterSchema>;
  readonly body: string;
} {
  if (!source.startsWith("---\n")) {
    throw new Error(`${sourceName}: document must start with frontmatter.`);
  }

  const boundary = source.indexOf("\n---\n", 4);
  if (boundary === -1) {
    throw new Error(`${sourceName}: frontmatter closing delimiter is missing.`);
  }

  const values: Record<string, string> = {};
  for (const [index, line] of source.slice(4, boundary).split("\n").entries()) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const match = /^([A-Za-z][A-Za-z0-9]*):\s*(.*)$/.exec(line);
    if (!match?.[1] || match[2] === undefined) {
      throw new Error(`${sourceName}:${index + 2}: invalid frontmatter line.`);
    }
    if (Object.hasOwn(values, match[1])) {
      throw new Error(`${sourceName}:${index + 2}: duplicate '${match[1]}'.`);
    }
    values[match[1]] = unquote(match[2]);
  }

  const parsed = frontmatterSchema.safeParse(values);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `${i.path.join(".") || "frontmatter"}: ${i.message}`)
      .join("; ");
    throw new Error(`${sourceName}: invalid frontmatter — ${issues}`);
  }

  const body = source.slice(boundary + "\n---\n".length).trim();
  if (!body) throw new Error(`${sourceName}: document body must not be empty.`);

  return { frontmatter: parsed.data, body };
}

export function isLegalDocType(value: string): value is LegalDocType {
  return (LEGAL_DOC_TYPES as readonly string[]).includes(value);
}

let contentRootPromise: Promise<string> | undefined;

/**
 * Resolve the content directory against both working directories that occur.
 *
 * The marketing app is invoked from its own directory in production, while
 * monorepo-level test commands run from the repository root. Assuming one of
 * them is worse than a wrong path: `getLocalLegalDocument` answers null for a
 * missing file, so the page renders "coming soon" and a test asserting exactly
 * that passes for entirely the wrong reason. Throwing when neither candidate
 * exists keeps a misplaced directory loud.
 */
async function getContentRoot(): Promise<string> {
  contentRootPromise ??= (async () => {
    const candidates = [
      join(process.cwd(), "content", "legal"),
      join(process.cwd(), "apps", "marketing", "content", "legal"),
    ];

    for (const candidate of candidates) {
      try {
        await access(candidate);
        return candidate;
      } catch {
        // Try the next one.
      }
    }

    throw new Error(
      "Marketing legal content directory was not found. Expected content/legal or apps/marketing/content/legal.",
    );
  })();

  return contentRootPromise;
}

/**
 * Read one published legal document, or null.
 *
 * A missing file, a draft, or malformed frontmatter all answer null, which the
 * pages already render as "coming soon". Throwing here would turn a Footer link
 * into a 500 for the sake of a content problem the visitor cannot act on.
 */
export const getLocalLegalDocument = cache(
  async (docType: string, locale: string): Promise<LegalDocument | null> => {
    if (!isLegalDocType(docType)) return null;
    if (!(LEGAL_LOCALES as readonly string[]).includes(locale)) return null;

    let root: string;
    try {
      root = await getContentRoot();
    } catch {
      return null;
    }

    const path = join(root, locale, `${docType}.md`);
    let source: string;
    try {
      source = await readFile(path, "utf8");
    } catch {
      return null;
    }

    let parsed: ReturnType<typeof parseLegalMarkdown>;
    try {
      parsed = parseLegalMarkdown(source, `${locale}/${docType}.md`);
    } catch {
      return null;
    }

    if (parsed.frontmatter.status !== "published") return null;

    const { title, version, effectiveDate } = parsed.frontmatter;
    const publishedAt = `${effectiveDate}T00:00:00.000Z`;

    return {
      // Stable and derived rather than random: it is only ever used as a React
      // key and as the argument to getLegalVersions.
      id: `${docType}:${locale}:${version}`,
      doc_type: docType,
      locale,
      title,
      content: parsed.body,
      version,
      effective_date: effectiveDate,
      is_current: true,
      published_at: publishedAt,
      created_at: publishedAt,
    };
  },
);
