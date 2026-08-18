// @input  -- every tool page that mounts a client component under next-intl
// @output -- a failing test when one of them ships the whole message catalogue
// @pos    -- the one guard on how much i18n reaches the browser
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const TOOLS_DIR = fileURLToPath(new URL(".", import.meta.url));

/**
 * `NextIntlClientProvider messages={messages}` serializes every message on the
 * site into the page's RSC payload and its server-rendered HTML. It is one
 * character away from the scoped form and costs about 220 KB per page, on tool
 * pages whose client components read one or two namespaces.
 *
 * The rule is checked here rather than left to review because the whole-object
 * form typechecks, renders correctly, and is invisible in every test that does
 * not weigh the response.
 */
const WHOLE_CATALOGUE = /messages=\{messages\}/;

function pagesWithProvider(): readonly (readonly [string, string])[] {
  const found: [string, string][] = [];
  for (const entry of readdirSync(TOOLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = `${TOOLS_DIR}${entry.name}/page.tsx`;
    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch {
      continue;
    }
    if (source.includes("NextIntlClientProvider")) {
      found.push([entry.name, source]);
    }
  }
  return found;
}

describe("tool pages ship only the messages their client reads", () => {
  const pages = pagesWithProvider();

  it("finds the tool pages that mount a client component", () => {
    // A rename that empties this list would make every assertion below vacuous.
    expect(pages.length).toBeGreaterThanOrEqual(4);
  });

  it.each(pages.map(([name]) => name))(
    "%s passes a scoped message object",
    (name) => {
      const source = pages.find(([candidate]) => candidate === name)?.[1] ?? "";
      expect(WHOLE_CATALOGUE.test(source), `${name} ships every message`).toBe(
        false,
      );
    },
  );
});
