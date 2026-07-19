import { readFile, rm, writeFile } from "node:fs/promises";
import type { FullResult, Reporter } from "@playwright/test/reporter";

export type E2eCleanupPaths = {
  distDir: string;
  blobDir?: string;
  nextEnvPath: string;
  generatedImportPattern: RegExp;
};

const canonicalRoutesImport = 'import "./.next/types/routes.d.ts";';

/**
 * Remove only the disposable artifacts owned by one E2E harness and restore
 * Next's generated type import after the corresponding server has exited.
 */
export async function cleanupE2eArtifacts(
  paths: E2eCleanupPaths,
): Promise<void> {
  const disposableDirectories = [paths.distDir];
  if (paths.blobDir) {
    disposableDirectories.push(paths.blobDir);
  }

  await Promise.all(
    disposableDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true, maxRetries: 3 }),
    ),
  );

  const current = await readFile(paths.nextEnvPath, "utf8");
  const restored = current.replace(
    paths.generatedImportPattern,
    canonicalRoutesImport,
  );
  if (restored !== current) {
    await writeFile(paths.nextEnvPath, restored, "utf8");
  }
}

/**
 * Playwright tears down its webServer plugin before reporter.onEnd. Keeping
 * artifact removal here prevents deleting Next chunks while the dev server is
 * still resolving them. A cleanup error still fails an otherwise-passing run.
 */
export class E2eCleanupReporter implements Reporter {
  constructor(
    private readonly harnessName: string,
    private readonly paths: E2eCleanupPaths,
  ) {}

  printsToStdio(): boolean {
    return false;
  }

  async onEnd(
    result: FullResult,
  ): Promise<{ status: "failed" } | undefined> {
    try {
      await cleanupE2eArtifacts(this.paths);
      return undefined;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(
        `[${this.harnessName} E2E cleanup] ${message}\n`,
      );
      return result.status === "passed" ? { status: "failed" } : undefined;
    }
  }
}
