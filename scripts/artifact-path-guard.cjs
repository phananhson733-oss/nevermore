"use strict";

const fs = require("node:fs");
const path = require("node:path");

function isInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function nearestExistingPath(candidatePath) {
  let current = candidatePath;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) {
      throw new Error(`Could not resolve an existing parent for ${candidatePath}`);
    }
    current = parent;
  }
  return current;
}

function assertRepositoryOwnedPath({
  repositoryRoot,
  candidatePath,
  label,
  mustExist = false,
  kind,
}) {
  const resolvedRepositoryRoot = path.resolve(repositoryRoot);
  const resolvedCandidate = path.resolve(candidatePath);

  if (!isInside(resolvedRepositoryRoot, resolvedCandidate)) {
    throw new Error(`${label} must stay inside the Nevermore repository`);
  }

  if (mustExist && !fs.existsSync(resolvedCandidate)) {
    throw new Error(`${label} does not exist: ${resolvedCandidate}`);
  }

  const physicalRepositoryRoot = fs.realpathSync.native(
    resolvedRepositoryRoot,
  );
  const existingPath = nearestExistingPath(resolvedCandidate);
  const physicalExistingPath = fs.realpathSync.native(existingPath);

  if (!isInside(physicalRepositoryRoot, physicalExistingPath)) {
    throw new Error(
      `${label} must be physically owned by the Nevermore repository`,
    );
  }

  if (fs.existsSync(resolvedCandidate)) {
    const stats = fs.lstatSync(resolvedCandidate);
    if (stats.isSymbolicLink()) {
      throw new Error(`${label} must not be a symbolic link`);
    }

    const physicalCandidate = fs.realpathSync.native(resolvedCandidate);
    if (!isInside(physicalRepositoryRoot, physicalCandidate)) {
      throw new Error(
        `${label} must be physically owned by the Nevermore repository`,
      );
    }

    if (kind === "file" && !stats.isFile()) {
      throw new Error(`${label} must be a regular file`);
    }
    if (kind === "directory" && !stats.isDirectory()) {
      throw new Error(`${label} must be a directory`);
    }
  }

  return resolvedCandidate;
}

module.exports = {
  assertRepositoryOwnedPath,
  isInside,
};
