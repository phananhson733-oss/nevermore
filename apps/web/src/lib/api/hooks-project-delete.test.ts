import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteProjectRequest,
  removeDeletedProjectQueries,
} from "./hooks.ts";

const PROJECT_ID = "00000000-0000-4000-8000-000000000003";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("product deletion browser boundary", () => {
  it("uses the project DELETE endpoint without a request body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await deleteProjectRequest(PROJECT_ID);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [path, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(path).toBe(`/api/mvp/projects/${PROJECT_ID}`);
    expect(init.method).toBe("DELETE");
    expect(init.body).toBeUndefined();
  });

  it("removes only deleted-project caches and invalidates project lists", async () => {
    const client = new QueryClient();
    const otherId = "00000000-0000-4000-8000-000000000004";
    client.setQueryData(["project", PROJECT_ID], { id: PROJECT_ID });
    client.setQueryData(["sources", PROJECT_ID], []);
    client.setQueryData(["project", otherId], { id: otherId });
    client.setQueryData(["projects", { archived: false }], { data: [] });

    await removeDeletedProjectQueries(client, PROJECT_ID);

    expect(client.getQueryData(["project", PROJECT_ID])).toBeUndefined();
    expect(client.getQueryData(["sources", PROJECT_ID])).toBeUndefined();
    expect(client.getQueryData(["project", otherId])).toEqual({ id: otherId });
    expect(
      client.getQueryState(["projects", { archived: false }])?.isInvalidated,
    ).toBe(true);
  });
});
