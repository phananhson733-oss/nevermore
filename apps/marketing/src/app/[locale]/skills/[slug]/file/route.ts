// @input  -- locale/slug route params 与 skills 内容库
// @output -- 以 text/markdown 下载的 SKILL.md 原文
// @pos    -- Skill 文件下载端点；刻意不用 .md 结尾的路径，避免绕过 proxy matcher
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

// Relative imports, not the `@/` alias: the shared Vitest config maps `@/` to
// apps/web only, so an aliased import here would not resolve in route.test.ts.
import {
  SKILL_FILE_NAME,
  getSkillForLocale,
  getSkillsForLocale,
} from "../../../../../lib/skill-content";
import { routing } from "../../../../../i18n/routing";

export const revalidate = 3600;

export async function generateStaticParams() {
  const perLocale = await Promise.all(
    routing.locales.map(async (locale) => {
      const { skills } = await getSkillsForLocale(locale);
      return skills.map((skill) => ({ locale, slug: skill.slug }));
    }),
  );
  return perLocale.flat();
}

/**
 * Serves the same bytes the file window displays.
 *
 * The route deliberately ends in `/file` rather than `/<slug>.md`: the proxy's
 * matcher skips any path containing a dot, so a `.md` URL would never reach
 * locale routing and would answer 404 in production while working in dev.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; slug: string }> },
) {
  const { locale, slug } = await params;
  const skill = await getSkillForLocale(slug, locale);

  if (!skill) {
    return new Response("Not found", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // Byte-for-byte what the file window shows and the copy button copies. Even a
  // trailing newline added here would make the page's central promise — that
  // this is the same file — false in a way nobody would think to check.
  return new Response(skill.fileContent, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      // The filename is the validated slug, so it cannot carry quotes or path
      // separators into the header.
      // Saved as SKILL.md, not <slug>.md: the spec identifies a skill by the
      // directory it sits in, so a file named after the slug is one a reader
      // has to rename before an agent will load it — and the rename is exactly
      // the step someone downloading a ready-made file will not think to do.
      "content-disposition": `attachment; filename="${SKILL_FILE_NAME}"`,
      "cache-control": "public, max-age=0, must-revalidate",
      // Every skill page links here, so a crawler reaches this URL whether or
      // not the sitemap lists it — and the bytes are a verbatim subset of that
      // page. A non-HTML response cannot carry <link rel="canonical">, so the
      // header is the only way to keep the file out of the index and stop it
      // competing with the page it came from.
      "x-robots-tag": "noindex",
    },
  });
}
