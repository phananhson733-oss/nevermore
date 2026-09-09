import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { describe, expect, it } from "vitest";

/*
 * Every schema handed to `keyword-llm-client.ts` is sent with `strict: true`
 * (see its `json_schema` assembly). Structured Outputs then refuses the whole
 * request -- HTTP 400, before the model runs -- for constructs a plain JSON
 * Schema validator accepts. Two of them shipped to production undetected and
 * turned every GEO knowledge generation into `provider_rejected`:
 *
 *   - `uniqueItems` anywhere: "'uniqueItems' is not permitted".
 *   - an `anyOf` branch that is not a schema in its own right: each branch
 *     needs its own `type`, `additionalProperties: false`, and a `required`
 *     naming every property.
 *
 * Both bounds below were measured against the production Azure deployment on
 * 2026-09-09, not read off documentation. `minLength` / `maxLength` / `pattern`
 * were measured in the same pass and are accepted, so they are not policed here.
 *
 * The list of schemas is swept, never enumerated: a third provider schema added
 * tomorrow is covered without editing this file.
 */

const SRC_ROOT = fileURLToPath(new URL("../..", import.meta.url));
const EXPORT_PATTERN = /export const ([A-Z][A-Z_0-9]*_RESPONSE_JSON_SCHEMA)\b/g;

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : sourceFiles(full);
    if (!entry.isFile() || !entry.name.endsWith(".ts")) return [];
    return entry.name.endsWith(".test.ts") ? [] : [full];
  });
}

function declaredSchemas(): readonly { readonly file: string; readonly name: string }[] {
  return sourceFiles(SRC_ROOT).flatMap((file) =>
    [...readFileSync(file, "utf8").matchAll(EXPORT_PATTERN)].map((match) => ({
      file,
      name: match[1]!,
    })),
  );
}

type Node = Record<string, unknown>;

function violations(node: unknown, at: string): readonly string[] {
  if (Array.isArray(node)) return node.flatMap((child, index) => violations(child, `${at}[${index}]`));
  if (node === null || typeof node !== "object") return [];
  const record = node as Node;
  const found: string[] = [];

  if ("uniqueItems" in record) found.push(`${at}: uniqueItems is not permitted under strict`);

  const branches = record.anyOf;
  if (Array.isArray(branches)) {
    branches.forEach((branch, index) => {
      const where = `${at}.anyOf[${index}]`;
      if (branch === null || typeof branch !== "object" || Array.isArray(branch)) {
        found.push(`${where}: branch is not an object schema`);
        return;
      }
      const child = branch as Node;
      if (child.type !== "object") found.push(`${where}: branch has no type: "object"`);
      if (child.additionalProperties !== false)
        found.push(`${where}: branch has no additionalProperties: false`);
      const properties = Object.keys((child.properties as Node | undefined) ?? {});
      const required = Array.isArray(child.required) ? (child.required as string[]) : [];
      const missing = properties.filter((key) => !required.includes(key));
      if (missing.length > 0) found.push(`${where}: branch does not require ${missing.join(", ")}`);
    });
  }

  if (record.type === "object") {
    if (record.additionalProperties !== false)
      found.push(`${at}: object has no additionalProperties: false`);
    const properties = Object.keys((record.properties as Node | undefined) ?? {});
    const required = Array.isArray(record.required) ? (record.required as string[]) : [];
    const missing = properties.filter((key) => !required.includes(key));
    if (missing.length > 0) found.push(`${at}: object does not require ${missing.join(", ")}`);
  }

  return [
    ...found,
    ...Object.entries(record).flatMap(([key, value]) => violations(value, `${at}.${key}`)),
  ];
}

describe("provider response schemas under strict Structured Outputs", () => {
  const declared = declaredSchemas();

  it("sweeps the source tree rather than trusting a hand-written list", () => {
    // A sweep that silently matches nothing would make every case below vacuous.
    expect(declared.length).toBeGreaterThanOrEqual(2);
    expect(new Set(declared.map((entry) => entry.name)).size).toBe(declared.length);
  });

  for (const { file, name } of declared) {
    it(`${name} carries nothing the provider refuses`, async () => {
      const module: Record<string, unknown> = await import(file);
      const exported = module[name] as { readonly name: string; readonly schema: unknown };

      expect(exported, `${name} is declared in ${file} but not exported`).toBeDefined();
      expect(violations(exported.schema, exported.name)).toEqual([]);
    });
  }
});
