#!/usr/bin/env node
/**
 * Convert the historical gengrowth-agents `blog_posts` SQL seeds into the
 * repository-backed GenGrowth blog format. It reads SQL only; it never opens a
 * database connection and will not overwrite an existing Markdown article
 * unless `--overwrite` is supplied deliberately.
 *
 * Usage:
 *   node scripts/migrate-legacy-blog-seed.mjs \
 *     --source /path/to/seed-blog.sql \
 *     --source /path/to/seed-blog-w25.sql \
 *     --output apps/marketing/content/blog \
 *     --manifest docs/marketing-blog-migration.md \
 *     --include-non-published
 */
import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";

const REQUIRED_COLUMNS = [
  "slug",
  "title",
  "content",
  "excerpt",
  "category",
  "pillar_slug",
  "locale",
  "locale_exclusive",
  "author",
  "published_at",
  "updated_at",
  "status",
];
const VALID_CATEGORIES = new Set([
  "case_study",
  "methodology",
  "weekly_review",
  "experiment_log",
]);
const VALID_PILLARS = new Set([
  "growth_automation",
  "experiment_driven",
  "attribution",
  "seo_content",
  "customer_stories",
]);
const LEGACY_PILLAR_ALIASES = new Map([
  ["automated-growth", "growth_automation"],
  ["social-first-growth", "experiment_driven"],
]);
const VALID_STATUSES = new Set(["draft", "published", "archived"]);
const VALID_LOCALES = new Set(["en", "zh"]);
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const DEFAULT_HERO_IMAGE = "/images/og-default.svg";

function usage(message) {
  if (message) console.error(`Error: ${message}`);
  console.error(
    "Usage: node scripts/migrate-legacy-blog-seed.mjs --source <legacy.sql> [--source <legacy.sql>] --output <content/blog> --manifest <migration.md> [--overwrite] [--include-non-published]",
  );
  process.exitCode = 2;
}

function parseArgs(argv) {
  const sources = [];
  let output;
  let manifest;
  let overwrite = false;
  let includeNonPublished = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--overwrite") {
      overwrite = true;
      continue;
    }
    if (argument === "--include-non-published") {
      includeNonPublished = true;
      continue;
    }
    if (!["--source", "--output", "--manifest"].includes(argument)) {
      usage(`unknown argument ${argument}`);
      return null;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      usage(`${argument} requires a value`);
      return null;
    }
    index += 1;
    if (argument === "--source") sources.push(value);
    if (argument === "--output") output = value;
    if (argument === "--manifest") manifest = value;
  }

  if (!sources.length || !output || !manifest) {
    usage("--source, --output, and --manifest are required");
    return null;
  }
  return { sources, output, manifest, overwrite, includeNonPublished };
}

function skipIgnorable(source, cursor) {
  let next = cursor;
  while (next < source.length) {
    if (/\s/u.test(source[next])) {
      next += 1;
      continue;
    }
    if (source.startsWith("--", next)) {
      const lineEnd = source.indexOf("\n", next);
      next = lineEnd === -1 ? source.length : lineEnd + 1;
      continue;
    }
    return next;
  }
  return next;
}

function readSqlTuple(source, start) {
  if (source[start] !== "(") throw new Error("expected SQL tuple");
  let depth = 0;
  let inString = false;
  for (let cursor = start; cursor < source.length; cursor += 1) {
    const character = source[cursor];
    if (inString) {
      if (character === "'" && source[cursor + 1] === "'") {
        cursor += 1;
      } else if (character === "'") {
        inString = false;
      }
      continue;
    }
    if (character === "'") {
      inString = true;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") {
      depth -= 1;
      if (depth === 0) return { inner: source.slice(start + 1, cursor), end: cursor + 1 };
    }
  }
  throw new Error("unterminated SQL tuple");
}

function splitSqlFields(tuple) {
  const fields = [];
  let start = 0;
  let depth = 0;
  let inString = false;
  for (let cursor = 0; cursor < tuple.length; cursor += 1) {
    const character = tuple[cursor];
    if (inString) {
      if (character === "'" && tuple[cursor + 1] === "'") {
        cursor += 1;
      } else if (character === "'") {
        inString = false;
      }
      continue;
    }
    if (character === "'") {
      inString = true;
      continue;
    }
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (character === "," && depth === 0) {
      fields.push(tuple.slice(start, cursor).trim());
      start = cursor + 1;
    }
  }
  fields.push(tuple.slice(start).trim());
  return fields;
}

function parseSqlLiteral(raw) {
  if (raw.toUpperCase() === "NULL") return null;
  if (raw.toUpperCase() === "TRUE") return true;
  if (raw.toUpperCase() === "FALSE") return false;
  if (raw.startsWith("'") && raw.endsWith("'")) {
    return raw.slice(1, -1).replaceAll("''", "'");
  }
  if (/^\d+$/u.test(raw)) return Number(raw);
  throw new Error(`unsupported SQL literal: ${raw.slice(0, 80)}`);
}

function extractInsertRows(source, sourceName) {
  const insertPattern = /INSERT\s+INTO\s+(?:public\.)?blog_posts\s*\(([^)]*)\)\s*VALUES\s*/giu;
  const rows = [];
  let match;
  while ((match = insertPattern.exec(source))) {
    const columns = match[1]
      .split(",")
      .map((column) => column.trim().replace(/^"|"$/gu, ""));
    const missingColumns = REQUIRED_COLUMNS.filter((column) => !columns.includes(column));
    if (missingColumns.length) {
      throw new Error(`${sourceName}: INSERT is missing ${missingColumns.join(", ")}`);
    }

    let cursor = skipIgnorable(source, insertPattern.lastIndex);
    while (source[cursor] === "(") {
      const tuple = readSqlTuple(source, cursor);
      const values = splitSqlFields(tuple.inner);
      if (values.length !== columns.length) {
        throw new Error(`${sourceName}: tuple has ${values.length} values for ${columns.length} columns`);
      }
      const row = Object.fromEntries(
        columns.map((column, index) => [column, parseSqlLiteral(values[index])]),
      );
      rows.push(row);
      cursor = skipIgnorable(source, tuple.end);
      if (source[cursor] !== ",") break;
      cursor = skipIgnorable(source, cursor + 1);
    }
    insertPattern.lastIndex = cursor;
  }
  return rows;
}

function singleLine(value) {
  return String(value ?? "")
    .replace(/[\r\n]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}

function toCalendarDate(value, field, identity) {
  const date = String(value ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date) || Number.isNaN(new Date(`${date}T00:00:00.000Z`).getTime())) {
    throw new Error(`${identity}: invalid ${field}`);
  }
  return date;
}

function normalizePillar(value, identity) {
  if (!value) return undefined;
  const normalized = LEGACY_PILLAR_ALIASES.get(value) ?? value;
  if (!VALID_PILLARS.has(normalized)) {
    throw new Error(`${identity}: unsupported pillar`);
  }
  return normalized;
}

function toMarkdown(row) {
  const identity = `${row.locale}/${row.slug}`;
  if (!VALID_LOCALES.has(row.locale)) throw new Error(`${identity}: unsupported locale`);
  if (!SLUG_PATTERN.test(row.slug)) throw new Error(`${identity}: invalid slug`);
  if (!VALID_CATEGORIES.has(row.category)) throw new Error(`${identity}: unsupported category`);
  if (!VALID_STATUSES.has(row.status)) throw new Error(`${identity}: unsupported status`);
  const pillar = normalizePillar(row.pillar_slug, identity);
  const title = singleLine(row.title);
  const excerpt = singleLine(row.excerpt);
  const author = singleLine(row.author);
  const heroImage = typeof row.hero_image === "string" && row.hero_image.startsWith("/")
    ? row.hero_image
    : DEFAULT_HERO_IMAGE;
  if (!title || !excerpt || !author) throw new Error(`${identity}: required editorial field is empty`);

  const frontmatter = [
    "---",
    `title: ${title}`,
    `excerpt: ${excerpt}`,
    `author: ${author}`,
    `category: ${row.category}`,
    ...(pillar ? [`pillar: ${pillar}`] : []),
    `status: ${row.status}`,
    `publishedAt: ${toCalendarDate(row.published_at, "published_at", identity)}`,
    `updatedAt: ${toCalendarDate(row.updated_at ?? row.published_at, "updated_at", identity)}`,
    `heroImage: ${heroImage}`,
    `heroImageAlt: Cover illustration for ${title}`,
    `localeExclusive: ${row.locale_exclusive ? "true" : "false"}`,
    "---",
    "",
    "<!-- Migrated losslessly from the legacy Supabase HTML body. New articles should use GFM Markdown. -->",
    String(row.content).trim(),
    "",
  ];
  return frontmatter.join("\n");
}

async function pathExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function sourceLabel(path) {
  const normalized = path.replaceAll("\\\\", "/");
  const legacyRoot = "/gengrowth-agents/";
  const rootIndex = normalized.lastIndexOf(legacyRoot);
  return rootIndex === -1 ? basename(path) : normalized.slice(rootIndex + 1);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options) return;
  const sourceRecords = [];
  const rows = [];
  for (const sourcePath of options.sources) {
    const contents = await readFile(sourcePath, "utf8");
    sourceRecords.push({ path: sourceLabel(sourcePath), sha256: digest(contents) });
    rows.push(...extractInsertRows(contents, sourcePath));
  }

  const published = rows.filter((row) => row.status === "published");
  const selected = options.includeNonPublished ? rows : published;
  const duplicateKeys = new Set();
  for (const row of selected) {
    const key = `${row.locale}:${row.slug}`;
    if (duplicateKeys.has(key)) throw new Error(`duplicate selected legacy content: ${key}`);
    duplicateKeys.add(key);
  }

  const generated = [];
  for (const row of selected) {
    const markdown = toMarkdown(row);
    const directory = join(options.output, row.locale);
    const destination = join(directory, `${row.slug}.md`);
    if (!options.overwrite && await pathExists(destination)) {
      throw new Error(`${destination} already exists; use --overwrite only after reviewing the diff`);
    }
    await mkdir(directory, { recursive: true });
    await writeFile(destination, markdown, "utf8");
    generated.push({ locale: row.locale, slug: row.slug, status: row.status, destination, sha256: digest(markdown) });
  }

  generated.sort((left, right) => `${left.locale}:${left.slug}`.localeCompare(`${right.locale}:${right.slug}`));
  const byLocale = Object.groupBy(generated, (entry) => entry.locale);
  const manifest = [
    "# GenGrowth legacy blog migration",
    "",
    "This manifest records the one-way content migration from the last preserved",
    "`gengrowth-agents` `blog_posts` SQL seeds into the repository-backed public",
    "GenGrowth blog. The importer is read-only with respect to Supabase: it reads",
    "SQL files and writes Markdown files only. No database migration or write was run.",
    "",
    "## Input provenance",
    "",
    ...sourceRecords.map((record) => `- \`${record.path}\` — SHA-256 \`${record.sha256}\``),
    "",
    "## Result",
    "",
    `- Legacy rows discovered: **${rows.length}**`,
    `- Published legacy rows discovered: **${published.length}**`,
    `- Markdown articles generated: **${generated.length}**${options.includeNonPublished ? " (including non-published content)" : ""}`,
    ...Object.entries(byLocale)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([locale, articles]) => `- \`${locale}\`: **${articles.length}** article(s)`),
    "- Every migrated source row is represented by the same `locale + slug` route.",
    "- The legacy HTML body is retained inside Markdown files for lossless first release;",
    "  the existing runtime sanitizes it through the same allow-list used for GFM output.",
    "- Missing legacy cover fields use the existing public `/images/og-default.svg` asset.",
    "",
    "## Generated routes and hashes",
    "",
    "| Route | Status | Markdown SHA-256 |",
    "| --- | --- | --- |",
    ...generated.map((article) => `| \`/${article.locale}/blog/${article.slug}\` | \`${article.status}\` | \`${article.sha256}\` |`),
    "",
    "## Cutover rule",
    "",
    "Keep `BLOG_LEGACY_SUPABASE_ENABLED=true` only while an independently verified",
    "legacy database still has published rows not represented above. After URL parity,",
    "rendering, image, RSS and sitemap checks pass on production, set it to `false`",
    "and remove the read-only bridge in a separate, reviewed change.",
    "",
  ].join("\n");
  await mkdir(dirname(options.manifest), { recursive: true });
  await writeFile(options.manifest, manifest, "utf8");
  console.log(`Migrated ${generated.length} article(s) into ${resolve(options.output)}.`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
