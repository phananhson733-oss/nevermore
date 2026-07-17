#!/usr/bin/env node
// Secret scanner (spec §18 `secrets:scan`, AC-040). Node stdlib only — runs in CI
// without installing dependencies. Walks the working tree (minus ignored build
// output and the sanctioned local secret store) and fails on any high-signal
// credential pattern: OAuth tokens, provider API keys, private keys, JWTs, and
// non-empty assignments of secret-named environment variables.
//
// The MVP invariant is that OAuth/API-key/cookie/ciphertext material never lands
// in source, logs, telemetry, reports, or exports (spec §1.3, §14, §15.3).

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

// Directories and files never scanned: build output, VCS, dependency trees, the
// lockfile, and the local-only secret store (.env.local is gitignored by design).
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "coverage",
  ".turbo",
  ".vercel",
  "playwright-report",
  "test-results",
]);
const IGNORE_FILES = new Set(["pnpm-lock.yaml", "secrets-scan.mjs"]);
const isLocalEnv = (name) => name === ".env.local" || name.endsWith(".local");

// Skip binary/asset extensions.
const BINARY_EXT =
  /\.(png|jpe?g|gif|webp|ico|pdf|zip|gz|tgz|woff2?|ttf|eot|mp4|mov|wasm|node)$/i;

/** High-signal secret patterns. Each match is a hard failure. */
const RULES = [
  { id: "google-oauth-access-token", re: /\bya29\.[0-9A-Za-z_-]{20,}/ },
  { id: "google-oauth-refresh-token", re: /\b1\/\/[0-9A-Za-z_-]{20,}/ },
  { id: "google-client-secret", re: /\bGOCSPX-[0-9A-Za-z_-]{10,}/ },
  { id: "openai-api-key", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/ },
  { id: "aws-access-key-id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "slack-token", re: /\bxox[baprs]-[0-9A-Za-z-]{10,}/ },
  { id: "private-key-block", re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  // JWTs (Supabase service_role keys are JWTs). header.payload.signature, base64url.
  { id: "jwt", re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/ },
  // Non-empty dotenv-style assignment of a secret-named var. Uses `=` only (not
  // `:`, which is object/type syntax) and a credential-shaped value of >=20
  // characters with no parentheses/space, so Zod schema fields like
  // `OPENAI_API_KEY: z.string().min(1)` and empty `KEY=` placeholders don't match.
  {
    id: "nonempty-secret-env",
    re: /\b(SERVICE_ROLE_KEY|CLIENT_SECRET|OAUTH_CLIENT_SECRET|ENCRYPTION_KEY|OPENAI_API_KEY|ANON_KEY|ACCESS_TOKEN|REFRESH_TOKEN|API_KEY)\s*=\s*["']?[A-Za-z0-9][A-Za-z0-9_\-./+=]{19,}/,
  },
];

// The scanner's own rule table and docs that quote these patterns are exempt.
const ALLOW_PATH = (rel) =>
  rel.startsWith("scripts/") || rel.startsWith("docs/vendor/");

const findings = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const st = statSync(abs);
    if (st.isDirectory()) {
      if (!IGNORE_DIRS.has(entry)) walk(abs);
      continue;
    }
    if (IGNORE_FILES.has(entry) || isLocalEnv(entry) || BINARY_EXT.test(entry)) continue;
    const rel = relative(ROOT, abs);
    if (ALLOW_PATH(rel)) continue;
    if (st.size > 2_000_000) continue; // skip very large files

    let text;
    try {
      text = readFileSync(abs, "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const rule of RULES) {
        if (rule.re.test(lines[i])) {
          findings.push({ file: rel, line: i + 1, rule: rule.id });
        }
      }
    }
  }
}

walk(ROOT);

if (findings.length > 0) {
  console.error(`Secret scan FAILED: ${findings.length} potential secret(s) found.`);
  for (const f of findings) {
    console.error(`- ${f.file}:${f.line} [${f.rule}]`);
  }
  process.exit(1);
}

console.log("Secret scan passed: no OAuth tokens, API keys, private keys, JWTs, or secret values found.");
