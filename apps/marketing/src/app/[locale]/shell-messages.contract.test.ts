// @input  -- layout.tsx's shellMessages and every namespace the header tree reads
// @output -- proof that the client boundary carries the copy the shell asks for
// @pos    -- the guard on a failure next-intl does not throw for

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import en from "../../i18n/messages/en.json";

function source(relative: string): string {
  return readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
}

/**
 * Every component rendered inside the header, directly or through it. Listed
 * rather than crawled: a crawl would have to resolve aliases and re-exports,
 * and the point is a guard simple enough to be obviously correct.
 */
const SHELL_COMPONENTS = [
  "../../components/layout/header.tsx",
  "../../components/layout/language-switcher.tsx",
  "../../components/layout/theme-toggle.tsx",
  "../../components/layout/tools-menu.tsx",
  "../../components/auth/sign-in-control.tsx",
  "../../components/auth/account-menu.tsx",
  "../../components/auth/sign-in-dialog.tsx",
  "../../components/layout/footer.tsx",
];

/** The top-level namespace of `useTranslations("a.b")` is `a`. */
function namespacesRead(text: string): readonly string[] {
  return [...text.matchAll(/useTranslations\("([^"]+)"\)/g)].map(
    (match) => (match[1] ?? "").split(".")[0] ?? "",
  );
}

function shellNamespaces(): readonly string[] {
  const layout = source("./layout.tsx");
  const block = layout.slice(
    layout.indexOf("const shellMessages = {"),
    layout.indexOf("};", layout.indexOf("const shellMessages = {")),
  );
  return [...block.matchAll(/^\s*(\w+):\s*messages\./gm)].map(
    (match) => match[1] ?? "",
  );
}

/**
 * A namespace missing from the client boundary does not throw. next-intl
 * renders the key's own path, so the header quietly reads "account.menu.balance"
 * where a word belongs — which is exactly how it shipped to a local preview
 * before this guard existed.
 */
describe("the shell's client message boundary", () => {
  it("carries every namespace the header tree reads", () => {
    const provided = new Set(shellNamespaces());
    const missing = SHELL_COMPONENTS.flatMap((path) =>
      namespacesRead(source(path))
        .filter((namespace) => !provided.has(namespace))
        .map((namespace) => `${path} reads "${namespace}"`),
    );

    expect(missing).toEqual([]);
  });

  it("names only namespaces the catalog actually has", () => {
    const absent = shellNamespaces().filter(
      (namespace) => !(namespace in en),
    );

    expect(absent).toEqual([]);
  });

  /** The list above is only a guard while it is not empty. */
  it("reads a non-trivial set of namespaces", () => {
    expect(shellNamespaces().length).toBeGreaterThan(3);
    expect(
      SHELL_COMPONENTS.flatMap((path) => namespacesRead(source(path))).length,
    ).toBeGreaterThan(2);
  });
});
