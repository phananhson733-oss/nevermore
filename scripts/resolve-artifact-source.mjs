import path from "node:path";
import { fileURLToPath } from "node:url";

import pathGuard from "./artifact-path-guard.cjs";

const { assertRepositoryOwnedPath } = pathGuard;

export const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const artifactPaths = Object.freeze({
  sourceDirectory: path.join(repositoryRoot, "docs", "artifact-src"),
  interactiveArtifact: path.join(
    repositoryRoot,
    "docs",
    "artifacts",
    "GenGrowth-Interactive-Artifact.html",
  ),
  productManual: path.join(
    repositoryRoot,
    "docs",
    "artifacts",
    "GenGrowth-Product-Manual.html",
  ),
});

const forbiddenPathPatterns = [
  [".codex visualization source", /(?:^|[/\\])\.codex[/\\]visualizations(?:[/\\]|$)/i],
  ["historical temporary dependency root", /(?:^|[/\\])tmp[/\\]gengrowth-artifact-jsdom-/i],
];

export function resolveRepositoryArtifactPath(argument, fallback, label) {
  const resolvedPath = argument
    ? path.resolve(repositoryRoot, argument)
    : fallback;

  assertRepositoryOwnedPath({
    repositoryRoot,
    candidatePath: resolvedPath,
    label,
  });

  for (const [description, pattern] of forbiddenPathPatterns) {
    if (pattern.test(resolvedPath)) {
      throw new Error(`${label} must not use ${description}: ${resolvedPath}`);
    }
  }

  return resolvedPath;
}

export function resolveArtifactBuildPaths({
  sourceDirectoryArgument,
  outputFileArgument,
} = {}) {
  return {
    sourceDirectory: resolveRepositoryArtifactPath(
      sourceDirectoryArgument,
      artifactPaths.sourceDirectory,
      "Artifact source directory",
    ),
    outputFile: resolveRepositoryArtifactPath(
      outputFileArgument,
      artifactPaths.interactiveArtifact,
      "Interactive Artifact output",
    ),
  };
}
