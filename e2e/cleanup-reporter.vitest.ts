import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanupE2eArtifacts,
  E2eCleanupReporter,
  type E2eCleanupPaths,
} from "./cleanup-reporter.ts";

const temporaryRoots: string[] = [];

async function makeFixture(): Promise<{
  root: string;
  paths: E2eCleanupPaths;
}> {
  const root = await mkdtemp(join(tmpdir(), "sf-e2e-cleanup-test-"));
  temporaryRoots.push(root);
  const distDir = join(root, ".next-e2e-test");
  const blobDir = join(root, "blobs");
  const nextEnvPath = join(root, "next-env.d.ts");
  await Promise.all([
    mkdir(join(distDir, "server"), { recursive: true }),
    mkdir(blobDir, { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(distDir, "server", "chunk.js"), "chunk", "utf8"),
    writeFile(join(blobDir, "artifact.json"), "{}", "utf8"),
    writeFile(
      nextEnvPath,
      [
        '/// <reference types="next" />',
        'import "./.next-e2e-test/dev/types/routes.d.ts";',
        "",
      ].join("\n"),
      "utf8",
    ),
  ]);
  return {
    root,
    paths: {
      distDir,
      blobDir,
      nextEnvPath,
      generatedImportPattern:
        /import "\.\/\.next-e2e-test\/[^"]+";/,
    },
  };
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      rm(root, { recursive: true, force: true }),
    ),
  );
});

describe("E2E artifact cleanup reporter", () => {
  it("removes only disposable directories and restores next-env", async () => {
    const { root, paths } = await makeFixture();
    const unrelated = join(root, "keep.txt");
    await writeFile(unrelated, "keep", "utf8");

    await cleanupE2eArtifacts(paths);

    await expect(access(paths.distDir)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(access(paths.blobDir!)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(unrelated, "utf8")).resolves.toBe("keep");
    await expect(readFile(paths.nextEnvPath, "utf8")).resolves.toContain(
      'import "./.next/types/routes.d.ts";',
    );
  });

  it("fails an otherwise-passing run when cleanup cannot finish", async () => {
    const { paths } = await makeFixture();
    paths.nextEnvPath = paths.distDir;
    const stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const reporter = new E2eCleanupReporter("test", paths);

    await expect(
      reporter.onEnd({ status: "passed", startTime: new Date(), duration: 1 }),
    ).resolves.toEqual({ status: "failed" });
    expect(stderr).toHaveBeenCalledWith(
      expect.stringContaining("[test E2E cleanup]"),
    );
  });

  it("does not overwrite an existing test failure with cleanup status", async () => {
    const { paths } = await makeFixture();
    paths.nextEnvPath = paths.distDir;
    vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const reporter = new E2eCleanupReporter("test", paths);

    await expect(
      reporter.onEnd({ status: "failed", startTime: new Date(), duration: 1 }),
    ).resolves.toBeUndefined();
  });
});
