import { describe, expect, it, vi } from "vitest";
import type { WorkerContext } from "../context.ts";
import type {
  PublicationExecutionAuthority,
  PublicationJobPayload,
} from "./run-publication.ts";

const mocks = vi.hoisted(() => ({
  createDbPublicationAuthority: vi.fn(),
  runPublication: vi.fn(),
}));

vi.mock("./db-authority.ts", () => ({
  createDbPublicationAuthority: mocks.createDbPublicationAuthority,
}));

vi.mock("./run-publication.ts", () => ({
  runPublication: mocks.runPublication,
}));

import { runPublicationJob } from "./worker.ts";

describe("runPublicationJob", () => {
  it("shares one immutable execution clock between authority loading and orchestration", async () => {
    const authority = {} as PublicationExecutionAuthority;
    let authorityClock: (() => Date) | undefined;
    mocks.createDbPublicationAuthority.mockImplementation(
      (_ctx: WorkerContext, clock: () => Date) => {
        authorityClock = clock;
        return authority;
      },
    );
    mocks.runPublication.mockImplementation(
      async (
        _payload: PublicationJobPayload,
        dependencies: {
          readonly authority: PublicationExecutionAuthority;
          readonly now: () => Date;
        },
      ) => {
        expect(dependencies.authority).toBe(authority);
        expect(dependencies.now).toBe(authorityClock);
        expect(dependencies.now()).toBe(dependencies.now());
      },
    );
    const payload: PublicationJobPayload = {
      runId: "00000000-0000-4000-8000-000000000001",
      workspaceId: "00000000-0000-4000-8000-000000000002",
      projectId: "00000000-0000-4000-8000-000000000003",
      contractVersion: "publication.0.4.0",
    };
    const ctx = {} as WorkerContext;

    await runPublicationJob(ctx, payload);

    expect(mocks.createDbPublicationAuthority).toHaveBeenCalledWith(
      ctx,
      expect.any(Function),
    );
    expect(mocks.runPublication).toHaveBeenCalledTimes(1);
  });
});
