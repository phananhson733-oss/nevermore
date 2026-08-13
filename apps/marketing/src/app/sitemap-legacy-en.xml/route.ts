// @input  — frozen pre-cutover English migration inventory
// @output — standalone XML sitemap containing only old /en URLs
// @pos    — temporary Google site-move discovery surface; separate from sitemap.xml

import { LEGACY_EN_MIGRATION_ENTRIES } from "../../lib/legacy-en-migration";

const SITE_ORIGIN = "https://gengrowth.ai";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

export function GET(): Response {
  const urls = LEGACY_EN_MIGRATION_ENTRIES.map(
    ({ legacyPath }) =>
      `  <url><loc>${escapeXml(`${SITE_ORIGIN}${legacyPath}`)}</loc></url>`,
  ).join("\n");
  const xml = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    urls,
    "</urlset>",
    "",
  ].join("\n");

  return new Response(xml, {
    status: 200,
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
      "Content-Type": "application/xml; charset=utf-8",
    },
  });
}
