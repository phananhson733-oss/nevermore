// @input  -- globals.css and every source file under components/tools
// @output -- a failing test when the three source-layer colours leak past their whitelist
// @pos    -- handoff §7: the source colours are information architecture, not decoration;
//            three files may read them and nothing else in components/tools may

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const GLOBALS_CSS = fileURLToPath(new URL("./globals.css", import.meta.url));
const TOOLS_DIR = fileURLToPath(
  new URL("../components/tools", import.meta.url),
);

const css = readFileSync(GLOBALS_CSS, "utf8");

/**
 * The files that may name a source colour, and why each one may.
 *
 * Every other card in the brief colours by STATE (the pill palette) or not at
 * all. A verdict card framed in the first-party green would read "your data
 * says create" where it means "this state is create", which is the confusion
 * the two palettes exist to keep apart.
 */
const SOURCE_TOKEN_ALLOWLIST = new Map<string, string>([
  ["content-brief-source-chip.tsx", "the chip that names a value's source layer"],
  ["content-brief-evidence-coverage.tsx", "each coverage cell is framed by its layer"],
  ["content-brief-outline-list.tsx", "the model-colour rule on every outline section"],
]);

const SOURCE_TOKEN = /--sc-source-|\bsource-(?:first|third|model)\b/;

function sourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      sourceFiles(full, acc);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

describe("source-layer tokens", () => {
  it("are defined in both theme blocks and mapped without literals", () => {
    for (const token of ["--sc-source-first", "--sc-source-third", "--sc-source-model"]) {
      const definitions = [
        ...css.matchAll(new RegExp(`^\\s{2}${token}:\\s*([^;]+);$`, "gm")),
      ];
      // Once per theme block: dark and light, with different values.
      expect(definitions, token).toHaveLength(2);
      expect(definitions[0]?.[1]).not.toBe(definitions[1]?.[1]);
      const utility = token.replace("--sc-", "--color-");
      expect(css).toContain(`${utility}: var(${token});`);
    }
  });

  const scanned = sourceFiles(TOOLS_DIR).map((file) => ({
    name: file.slice(TOOLS_DIR.length + 1),
    body: readFileSync(file, "utf8"),
  }));

  it("scans the tools directory, allowlist included", () => {
    const names = new Set(scanned.map((file) => file.name));
    for (const allowed of SOURCE_TOKEN_ALLOWLIST.keys()) {
      expect(names, `allowlisted ${allowed} was not scanned`).toContain(allowed);
    }
    expect(scanned.length).toBeGreaterThan(20);
  });

  it("appear in every allowlisted file", () => {
    // An allowlist entry that no longer uses the colour is a stale exemption
    // waiting for a future file to hide behind.
    for (const allowed of SOURCE_TOKEN_ALLOWLIST.keys()) {
      const body = scanned.find((file) => file.name === allowed)?.body ?? "";
      expect(SOURCE_TOKEN.test(body), `${allowed} no longer reads a source colour`).toBe(true);
    }
  });

  it("appear nowhere else under components/tools", () => {
    const offenders = scanned
      .filter(({ name }) => !SOURCE_TOKEN_ALLOWLIST.has(name))
      .flatMap(({ name, body }) =>
        body
          .split("\n")
          .map((line, index) => ({ line, index }))
          .filter(({ line }) => SOURCE_TOKEN.test(line))
          .map(({ line, index }) => `${name}:${index + 1}: ${line.trim()}`),
      );
    expect(offenders).toEqual([]);
  });
});
