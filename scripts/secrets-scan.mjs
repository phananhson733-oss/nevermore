#!/usr/bin/env node
// Secret scanner (spec §18 `secrets:scan`, AC-040). Node stdlib only — runs in CI
// without installing dependencies. Walks the working tree (minus ignored build
// output and the sanctioned local secret store) and fails on any high-signal
// credential pattern: OAuth tokens, provider API keys, private keys, JWTs, and
// non-empty assignments of secret-named environment variables.
//
// The MVP invariant is that OAuth/API-key/cookie/ciphertext material never lands
// in source, logs, telemetry, reports, or exports (spec §1.3, §14, §15.3).

import { lstatSync, readFileSync, readlinkSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

// Directories and files never scanned: build output, VCS, dependency trees, the
// lockfile, generated local data stores, and the local-only secret store
// (.env.local is gitignored by design). All remaining text files are scanned
// regardless of size so a large first-party source file cannot evade the gate.
const IGNORE_DIRS = new Set([
  "node_modules",
  ".git",
  ".next",
  "dist",
  "coverage",
  ".turbo",
  ".vercel",
  ".data",
  "playwright-report",
  "test-results",
]);
const IGNORE_RELATIVE_FILES = new Set([
  "pnpm-lock.yaml",
  "scripts/secrets-scan.mjs",
]);
const isIgnoredRuntimeDir = (name) =>
  name.startsWith(".next-e2e-") || name.startsWith("blob-");
const isLocalEnv = (name) =>
  name === ".env.local" ||
  /^\.env\..+\.local$/.test(name) ||
  /^\.env\.local\.bak-/.test(name);

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

// The scanner itself is excluded by exact repository-relative path because its
// rule table must contain the signatures it detects. No source or documentation
// subtree is allowlisted: release scripts and provenance metadata are scanned too.

const findings = [];

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    // Never follow a repository symlink outside the checkout. Git commits the
    // link target text, not the target bytes, so scan that text in place.
    let st;
    try {
      st = lstatSync(abs);
    } catch (error) {
      if (error && typeof error === "object" && error.code === "ENOENT") {
        // Ephemeral build/test outputs can disappear between readdir and lstat.
        // Treat vanished paths as absent so the scan remains stable.
        continue;
      }
      throw error;
    }
    if (st.isDirectory()) {
      if (!IGNORE_DIRS.has(entry) && !isIgnoredRuntimeDir(entry)) walk(abs);
      continue;
    }
    if (!st.isFile() && !st.isSymbolicLink()) continue;
    const rel = relative(ROOT, abs);
    if (
      IGNORE_RELATIVE_FILES.has(rel) ||
      isLocalEnv(entry) ||
      BINARY_EXT.test(entry)
    ) {
      continue;
    }
    let text;
    try {
      text = st.isSymbolicLink() ? readlinkSync(abs) : readFileSync(abs, "utf8");
    } catch {
      // An unreadable in-scope file is an unknown secret boundary. Fail closed
      // without reflecting the OS exception or any file content.
      findings.push({ file: rel, line: 0, rule: "unreadable-file" });
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
    const location = f.line > 0 ? `${f.file}:${f.line}` : f.file;
    console.error(`- ${location} [${f.rule}]`);
  }
  process.exit(1);
}

console.log("Secret scan passed: no OAuth tokens, API keys, private keys, JWTs, or secret values found.");
