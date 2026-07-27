"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  assertRepositoryOwnedPath,
} = require("./artifact-path-guard.cjs");

function withFixture(run) {
  const fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "nevermore-artifact-paths-"),
  );
  const repositoryRoot = path.join(fixtureRoot, "repository");
  const externalRoot = path.join(fixtureRoot, "external");
  fs.mkdirSync(repositoryRoot);
  fs.mkdirSync(externalRoot);

  try {
    run({ repositoryRoot, externalRoot });
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
}

test("accepts regular files and missing outputs under the physical repository", () => {
  withFixture(({ repositoryRoot }) => {
    const source = path.join(repositoryRoot, "source.js");
    fs.writeFileSync(source, "window.fixture = true;\n");

    assert.equal(
      assertRepositoryOwnedPath({
        repositoryRoot,
        candidatePath: source,
        label: "Source",
        mustExist: true,
        kind: "file",
      }),
      source,
    );

    const futureOutput = path.join(repositoryRoot, "output.html");
    assert.equal(
      assertRepositoryOwnedPath({
        repositoryRoot,
        candidatePath: futureOutput,
        label: "Output",
      }),
      futureOutput,
    );
  });
});

test("rejects lexical and physical escapes from the repository", () => {
  withFixture(({ repositoryRoot, externalRoot }) => {
    const externalFile = path.join(externalRoot, "external.html");
    fs.writeFileSync(externalFile, "<p>external</p>\n");

    assert.throws(
      () =>
        assertRepositoryOwnedPath({
          repositoryRoot,
          candidatePath: externalFile,
          label: "Outside",
        }),
      /must stay inside/,
    );

    const linkedDirectory = path.join(repositoryRoot, "linked-directory");
    fs.symlinkSync(externalRoot, linkedDirectory);
    assert.throws(
      () =>
        assertRepositoryOwnedPath({
          repositoryRoot,
          candidatePath: path.join(linkedDirectory, "future.html"),
          label: "Linked parent",
        }),
      /physically owned/,
    );

    const linkedFile = path.join(repositoryRoot, "linked-file.html");
    fs.symlinkSync(externalFile, linkedFile);
    assert.throws(
      () =>
        assertRepositoryOwnedPath({
          repositoryRoot,
          candidatePath: linkedFile,
          label: "Linked file",
          mustExist: true,
          kind: "file",
        }),
      /physically owned|symbolic link/,
    );
  });
});
