import { randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??=
  Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import { createDbHandle, type DbHandle } from "@sf/db/client";
import { workspaces } from "@sf/db/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import { getWorkspaceView } from "@/lib/services/workspace-view";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;
const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

/**
 * Regression: the overview projection must satisfy the OpenAPI contract
 * (`OverviewView.coverage` is required + non-nullable). A fresh project has no
 * diagnostic run, so the underlying findings coverage is null; the projection
 * must substitute the honest empty coverage (`overall: "unavailable"`) rather
 * than emit null — a null crashed the overview client (`null.overall`).
 */
describeDb("workspace overview coverage (spec §11.3, AC-036)", () => {
  let handle: DbHandle;
  let workspaceId: string;
  const actor = randomUUID();

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    const [ws] = await handle.db
      .insert(workspaces)
      .values({ name: `WS-${randomUUID()}` })
      .returning();
    workspaceId = ws!.id;
  });
  afterAll(async () => {
    await handle?.end();
  });

  it("returns a non-null unavailable coverage for a project with no diagnostic run", async () => {
    const created = await createProject(
      { workspaceId },
      actor,
      randomUUID(),
      {
        clientName: "Fresh",
        projectName: "Fresh",
        siteUrl: "https://fresh.example",
        marketCodes: ["US"],
        siteLanguageCodes: ["en"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );

    const view = await getWorkspaceView(
      { workspaceId },
      created.project.id,
      "overview",
    );

    expect(view.view).toBe("overview");
    if (view.view !== "overview") throw new Error("expected overview view");
    // The contract-critical assertion: coverage is present and honestly empty.
    expect(view.coverage).not.toBeNull();
    expect(view.coverage.overall).toBe("unavailable");
    expect(view.coverage.domains).toEqual({});
    expect(view.coverage.limitations).toEqual([]);
  });
});
