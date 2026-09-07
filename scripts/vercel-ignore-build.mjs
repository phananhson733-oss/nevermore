import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

function workspaceScope(root, project) {
  const workspaces = new Map();
  for (const base of ["apps", "packages"]) {
    for (const entry of readdirSync(join(root, base), { withFileTypes: true })) {
      const path = `${base}/${entry.name}/`;
      const manifestPath = join(root, path, "package.json");
      if (!entry.isDirectory() || !existsSync(manifestPath)) continue;
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
      if (typeof manifest.name !== "string" || workspaces.has(manifest.name)) {
        throw new Error("ambiguous workspace");
      }
      workspaces.set(manifest.name, { path, manifest });
    }
  }
  const target = [...workspaces.values()].find((item) => item.path === `apps/${project}/`);
  if (!target) throw new Error("missing app workspace");
  const affected = new Set();
  function visit(item) {
    if (affected.has(item.path)) return;
    affected.add(item.path);
    for (const group of ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"]) {
      for (const [name, version] of Object.entries(item.manifest[group] ?? {})) {
        if (workspaces.has(name)) visit(workspaces.get(name));
        else if (typeof version === "string" && /^(workspace|file|link):/.test(version)) {
          throw new Error("unresolved local dependency");
        }
      }
    }
  }
  visit(target);
  return { affected: [...affected], all: [...workspaces.values()].map((item) => item.path) };
}

// Vercel's Ignored Build Step runs before dependency installation, in the app
// root. Exit 0 cancels a build; exit 1 allows it. Uncertainty must allow builds.
function decision(project, env) {
  const build = (reason) => ({ skip: false, reason });
  const skip = (reason) => ({ skip: true, reason });
  if (!["marketing", "web"].includes(project)) return build("unknown project");
  if (env.VERCEL_GIT_PROVIDER !== "github") return build("not a GitHub build");
  if (!["production", "preview"].includes(env.VERCEL_ENV)) return build("unknown environment");
  if (env.VERCEL_TARGET_ENV && env.VERCEL_TARGET_ENV !== env.VERCEL_ENV) {
    return build("custom environment");
  }
  if (
    project === "marketing" && env.VERCEL_ENV === "preview" &&
    env.VERCEL_GIT_COMMIT_REF === "main" && !env.VERCEL_GIT_PULL_REQUEST_ID
  ) return skip("redundant Marketing main preview");

  const previous = env.VERCEL_GIT_PREVIOUS_SHA;
  const current = env.VERCEL_GIT_COMMIT_SHA;
  const isSha = (value) => typeof value === "string" && /^[a-f0-9]{40}$/i.test(value);
  if (!isSha(previous) || !isSha(current)) return build("missing deployment history");

  const git = (...args) => execFileSync("git", args, {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
    timeout: 5000, maxBuffer: 1024 * 1024,
  });
  try {
    const root = git("rev-parse", "--show-toplevel").trim();
    const head = git("rev-parse", "HEAD").trim();
    if (head !== current) return build("checkout differs from deployment SHA");
    if (previous === head) return build("same-SHA redeploy");
    // No fetching in the early build gate. First deployments, shallow clones
    // without this ancestor, rollbacks and rewritten branches build normally.
    git("merge-base", "--is-ancestor", previous, head);
    const changed = git("-C", root, "diff", "--name-only", "--no-renames", "-z", previous, head, "--")
      .split("\0").filter(Boolean);
    const documentationOnly = (path) =>
      path.endsWith(".md") && [
        "docs/plans/", "docs/reviews/", "docs/external-reviews/", "docs/superpowers/plans/",
      ].some((prefix) => path.startsWith(prefix));
    if (changed.length > 0 && changed.every(documentationOnly)) {
      return skip("only plan/review Markdown since last successful deployment");
    }
    if (changed.length === 0) return build("empty diff redeploy");
    // Vercel treats root docs as global, so remove only the reviewed Markdown
    // paths before checking the app's transitive workspace dependency closure.
    const scope = workspaceScope(root, project);
    for (const path of changed.filter((path) => !documentationOnly(path))) {
      if (scope.affected.some((prefix) => path.startsWith(prefix))) return build("app or dependency changes");
      if (!scope.all.some((prefix) => path.startsWith(prefix))) return build("global or unknown changes");
    }
    return skip("no app or dependency changes after excluding plan/review Markdown");
  } catch {
    return build("Git comparison unavailable");
  }
}

const result = decision(process.argv[2], process.env);
console.log(`[vercel-build] ${result.skip ? "skip" : "build"}: ${result.reason}`);
process.exitCode = result.skip ? 0 : 1;
