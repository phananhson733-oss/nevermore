import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(root, "scripts/vercel-ignore-build.mjs");

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), "vercel-build-policy-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", ["-C", dir, ...args], { encoding: "utf8" }).trim();
  git("init", "-b", "main");
  git("config", "user.email", "fixture@example.test");
  git("config", "user.name", "Build policy fixture");
  for (const [path, manifest] of [
    ["apps/marketing/package.json", { name: "@fixture/marketing", dependencies: { "@fixture/sources": "workspace:*" } }],
    ["apps/web/package.json", { name: "@fixture/web", dependencies: { "@fixture/sources": "workspace:*" } }],
    ["packages/sources/package.json", { name: "@fixture/sources", dependencies: { "@fixture/contracts": "workspace:*" } }],
    ["packages/contracts/package.json", { name: "@fixture/contracts" }],
  ]) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), JSON.stringify(manifest));
  }
  git("add", ".");
  function commit(path, value = "fixture\n") {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), value);
    git("add", "--", path);
    git("commit", "-qm", "fixture");
    return git("rev-parse", "HEAD");
  }
  const base = commit("apps/marketing/src/page.ts", "export default 1;\n");
  mkdirSync(join(dir, "apps/web"), { recursive: true });
  function run(project, overrides = {}, cwd = join(dir, "apps", project === "marketing" ? "marketing" : "web")) {
    mkdirSync(cwd, { recursive: true });
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("VERCEL_")));
    Object.assign(env, {
      VERCEL_GIT_PROVIDER: "github", VERCEL_ENV: "production",
      VERCEL_TARGET_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
      VERCEL_GIT_COMMIT_SHA: git("rev-parse", "HEAD"), VERCEL_GIT_PREVIOUS_SHA: base,
    }, overrides);
    const result = spawnSync(process.execPath, [script, project], { cwd, env, encoding: "utf8" });
    assert.equal(result.signal, null);
    assert.equal(result.stderr, "", result.stderr);
    assert.match(result.stdout, /\[vercel-build\]/, result.stdout);
    return result;
  }
  return { dir, base, git, commit, run };
}

test("only the redundant Marketing Git main preview is skipped", (t) => {
  const f = fixture(t);
  f.commit("apps/marketing/src/page.ts", "export default 2;\n");
  f.commit("packages/sources/index.ts", "export default 2;\n");
  const preview = { VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview" };
  assert.equal(f.run("marketing", preview).status, 0);
  assert.equal(f.run("marketing").status, 1);
  assert.equal(f.run("web", preview).status, 1);
  assert.equal(f.run("marketing", { ...preview, VERCEL_GIT_COMMIT_REF: "feature/card" }).status, 1);
  assert.equal(f.run("marketing", { ...preview, VERCEL_GIT_PULL_REQUEST_ID: "12" }).status, 1);
  assert.equal(f.run("marketing", { ...preview, VERCEL_TARGET_ENV: "staging" }).status, 1);
  assert.equal(f.run("marketing", { ...preview, VERCEL_GIT_PROVIDER: "" }).status, 1);
});

test("plan/review-only pushes skip both apps from their configured roots", (t) => {
  const f = fixture(t);
  for (const path of ["docs/plans/a.md", "docs/reviews/b.md", "docs/external-reviews/c.md", "docs/superpowers/plans/d.md"]) f.commit(path);
  assert.equal(f.run("marketing").status, 0);
  assert.equal(f.run("web").status, 0);
  assert.equal(f.run("marketing", { VERCEL_ENV: "preview", VERCEL_TARGET_ENV: "preview", VERCEL_GIT_COMMIT_REF: "feature/docs" }).status, 0);
});

for (const path of ["packages/sources/index.ts", "packages/contracts/schema.ts", "pnpm-lock.yaml", "docs/artifact-src/app.ts", "docs/DEPLOYMENT.md", "docs/plans/tool.mjs", "authority/spec.md"]) {
  test(`a documentation tail must not hide an unbuilt change to ${path}`, (t) => {
    const f = fixture(t);
    f.commit(path, "changed\n");
    f.commit("docs/plans/follow-up.md");
    assert.equal(f.run("marketing").status, 1);
    assert.equal(f.run("web").status, 1);
  });
}

test("a Marketing change plus a review does not rebuild Product, and vice versa", (t) => {
  const f = fixture(t);
  const marketing = f.commit("apps/marketing/src/card.ts");
  f.commit("docs/reviews/marketing.md");
  assert.equal(f.run("marketing").status, 1);
  assert.equal(f.run("web").status, 0);
  const previous = f.git("rev-parse", "HEAD");
  f.commit("apps/web/src/page.ts");
  f.commit("docs/plans/web.md");
  assert.equal(f.run("marketing", { VERCEL_GIT_PREVIOUS_SHA: previous }).status, 0);
  assert.equal(f.run("web", { VERCEL_GIT_PREVIOUS_SHA: marketing }).status, 1);
});

test("an unknown or broken workspace dependency causes a build", (t) => {
  const f = fixture(t);
  const previous = f.commit("apps/web/package.json", JSON.stringify({ name: "@fixture/web", dependencies: { "@fixture/missing": "workspace:*" } }));
  f.commit("apps/marketing/src/card.ts");
  f.commit("docs/plans/note.md");
  assert.equal(f.run("web", { VERCEL_GIT_PREVIOUS_SHA: previous }).status, 1);
});

test("a shallow clone missing the last successful commit builds normally", (t) => {
  const f = fixture(t);
  f.commit("docs/reviews/new.md");
  const clone = join(f.dir, "shallow");
  execFileSync("git", ["clone", "--quiet", "--depth=1", `file://${f.dir}`, clone]);
  assert.equal(f.run("marketing", {}, join(clone, "apps/marketing")).status, 1);
});

test("missing, invalid, unrelated or identical deployment baselines build safely", (t) => {
  const f = fixture(t);
  const head = f.commit("docs/reviews/only.md");
  for (const overrides of [
    { VERCEL_GIT_PREVIOUS_SHA: "" },
    { VERCEL_GIT_PREVIOUS_SHA: "0".repeat(40) },
    { VERCEL_GIT_PREVIOUS_SHA: "--help" },
    { VERCEL_GIT_PREVIOUS_SHA: head },
    { VERCEL_GIT_COMMIT_SHA: f.base },
    { VERCEL_ENV: "" },
  ]) assert.equal(f.run("marketing", overrides).status, 1);
  assert.equal(f.run("unknown").status, 1);
  f.git("checkout", "--orphan", "unrelated");
  f.git("rm", "-rf", ".");
  const other = f.commit("docs/plans/other.md");
  assert.equal(f.run("marketing", { VERCEL_GIT_COMMIT_SHA: other }).status, 1);
});

test("renaming code into docs cannot hide the removed runtime file", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.dir, "docs/plans"), { recursive: true });
  f.git("mv", "apps/marketing/src/page.ts", "docs/plans/moved.md");
  f.git("commit", "-qm", "move");
  assert.equal(f.run("marketing").status, 1);
});

test("deleted and newline-containing Markdown review paths are handled as filenames", (t) => {
  const f = fixture(t);
  const previous = f.commit("docs/reviews/delete.md");
  f.git("rm", "docs/reviews/delete.md");
  f.git("commit", "-qm", "delete");
  f.commit("docs/plans/name\nwith-newline.md");
  assert.equal(f.run("web", { VERCEL_GIT_PREVIOUS_SHA: previous }).status, 0);
});

test("both Vercel roots and manual CI execute the dependency-free guard/tests", () => {
  for (const project of ["marketing", "web"]) {
    const config = JSON.parse(readFileSync(join(root, "apps", project, "vercel.json"), "utf8"));
    assert.equal(config.ignoreCommand, `node ../../scripts/vercel-ignore-build.mjs ${project}`);
  }
  assert.match(readFileSync(join(root, ".github/workflows/ci.yml"), "utf8"), /node --test scripts\/vercel-ignore-build\.test\.mjs/);
});
