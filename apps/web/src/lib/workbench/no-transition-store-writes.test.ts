/**
 * Static gate: no workbench module enters a Transition (codex S6r3 #3).
 *
 * `LoadDemoButton` and `useClearSample` dispatch a store write inside
 * `flushSync` and read the store straight after it to learn whether the reducer
 * took the write. In React 19.2 `flushSync` processes only the sync lanes
 * (Sync, InputContinuous, Default). An update queued in a Transition lane is
 * skipped by that render and replayed after it, so a write queued there ahead
 * of the dispatch lands after the read-back and undoes its conclusion: codex
 * queued `addArtifact` in `startTransition`, ran `clearDemo` in `flushSync`,
 * and read `demo=false` straight away but `demo=true` once things settled.
 * Non-test workbench code had zero Transition writes when this gate was added.
 *
 * Every API below queues its updates in a Transition lane, so none may appear
 * in a non-test .ts / .tsx module under components/workbench/ or
 * lib/workbench/: `startTransition`, `useTransition`, `useActionState`,
 * `useOptimistic`, a `<form>` tag with an `action={...}` prop, and a
 * `formAction={...}` prop (the same thing on a submit button). Names match
 * inside comments too; prose there should say "a Transition".
 *
 * Exempt, by file and by occurrence count: `shell/SignOutButton.tsx` renders
 * one `<form action={...}>` for the sign-out server action, which writes
 * nothing to the store. Its store-facing part, the storage sweep and the event
 * that tells the provider, runs in `onSubmit`, a discrete event handler that
 * React calls before the form action's listener (which checks whether
 * `onSubmit` prevented the default) starts the Transition.
 *
 * Not seen here: a Transition entered by library code (Next's router
 * navigation, `<Link>`), a Transition entered outside these two directories
 * around a callback that writes to the store, or a wrapper component with
 * another name that renders a `<form action>` defined elsewhere.
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const LIB_WORKBENCH = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(LIB_WORKBENCH, "../..");
const ROOTS = [resolve(SRC, "components/workbench"), LIB_WORKBENCH] as const;

/**
 * Walked 2026-09-14: 53 tracked non-test modules under components/workbench
 * and 57 under lib/workbench (119 on disk with work in progress). The floors
 * sit below that, so a root that moved fails here instead of passing on an
 * empty walk.
 */
const MIN_MODULES_PER_ROOT = 45;
const MIN_MODULES = 100;

const TRANSITION_API = /\b(?:startTransition|useTransition|useActionState|useOptimistic)\b/g;
const FORM_ACTION_PROP = /\bformAction\s*=\s*\{/g;
const ACTION_PROP = /\baction\s*=\s*\{/;

/** Paths relative to src/, with how many form actions each may hold. */
const EXEMPT_FORM_ACTIONS: Readonly<Record<string, number>> = {
  "components/workbench/shell/SignOutButton.tsx": 1,
};

function modulesUnder(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return modulesUnder(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [path] : [];
  });
}

/**
 * The `<form ...>` opening tag starting at `start`. It ends at the first `>`
 * outside braces, so an arrow function in another prop does not end it early.
 */
function openingTag(source: string, start: number): string {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    else if (char === "}") depth -= 1;
    else if (char === ">" && depth === 0) return source.slice(start, index + 1);
  }
  return source.slice(start);
}

/** `<form>` tags carrying `action={`, plus `formAction={` props anywhere. */
function formActions(source: string): number {
  const onForms = [...source.matchAll(/<form\b/g)].filter((match) =>
    ACTION_PROP.test(openingTag(source, match.index)),
  ).length;
  return onForms + [...source.matchAll(FORM_ACTION_PROP)].length;
}

const MODULES = ROOTS.map((root) => ({ root, files: modulesUnder(root) }));
const FILES = MODULES.flatMap(({ files }) => files);

describe("no workbench module enters a Transition (codex S6r3 #3)", () => {
  it("walks both roots", () => {
    for (const { root, files } of MODULES) {
      expect(files.length, relative(SRC, root)).toBeGreaterThanOrEqual(MIN_MODULES_PER_ROOT);
    }
    expect(FILES.length).toBeGreaterThanOrEqual(MIN_MODULES);
  });

  it("names no Transition API", () => {
    const hits = FILES.flatMap((file) =>
      [...readFileSync(file, "utf8").matchAll(TRANSITION_API)].map((match) => `${relative(SRC, file)}: ${match[0]}`),
    );
    expect(hits).toEqual([]);
  });

  it("has no form action but the exempt one, which is still there", () => {
    const found = Object.fromEntries(
      FILES.map((file) => [relative(SRC, file), formActions(readFileSync(file, "utf8"))] as const).filter(
        ([, count]) => count > 0,
      ),
    );
    expect(found).toEqual(EXEMPT_FORM_ACTIONS);
  });

  it("reads a form tag to its end and only form tags", () => {
    expect(formActions("<form onSubmit={() => count > 1} action={go}>")).toBe(1);
    expect(formActions("<form\n  onSubmit={() => {\n    sweep();\n  }}\n  action={go}\n>")).toBe(1);
    expect(formActions("<form onSubmit={submit}><button formAction={go} /></form>")).toBe(1);
    expect(formActions("<SignOutButton action={signOut} />")).toBe(0);
    expect(formActions("<form onSubmit={submit}><EmptyState action={<b />} /></form>")).toBe(0);
  });
});
