import { randomUUID } from "node:crypto";

process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??= Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "test-client-id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "test-client-secret";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import { eq, sql } from "drizzle-orm";
import { createDbHandle, type DbHandle } from "@sf/db";
import { clientProjects, workspaces } from "@sf/db/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createProject, type UrlGuard } from "@/lib/services/projects";
import { listProjectSources } from "@/lib/services/sources";
import { seedConfirmedSourceProfile } from "./confirmed-source-profile-fixture";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;

const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

describeDb("Sources read Product/ICP gate integration", () => {
  let handle: DbHandle;
  let workspaceId: string;
  const actorId = randomUUID();

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL);
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `Sources read gate ${randomUUID()}` })
      .returning();
    workspaceId = workspace!.id;
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("blocks active unconfirmed reads, preserves archived history, and allows active confirmed reads", async () => {
    const unconfirmed = await createProject(
      { workspaceId },
      actorId,
      randomUUID(),
      {
        clientName: "Unconfirmed Sources client",
        projectName: "Unconfirmed Sources project",
        siteUrl: `https://sources-unconfirmed-${randomUUID()}.example`,
        marketCodes: ["US"],
        siteLanguageCodes: ["en-US"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );

    await expect(
      listProjectSources(
        { workspaceId },
        unconfirmed.project.id,
      ),
    ).rejects.toMatchObject({
      code: "CONTEXT_INCOMPLETE",
      status: 422,
    });

    await handle.db
      .update(clientProjects)
      .set({ archived_at: sql`now()` })
      .where(eq(clientProjects.id, unconfirmed.project.id));

    const archivedHistory = await listProjectSources(
      { workspaceId },
      unconfirmed.project.id,
    );
    expect(archivedHistory.find((slot) => slot.provider === "crawl")).toMatchObject({
      id: expect.any(String),
      projectId: unconfirmed.project.id,
      provider: "crawl",
    });

    const confirmed = await createProject(
      { workspaceId },
      actorId,
      randomUUID(),
      {
        clientName: "Confirmed Sources client",
        projectName: "Confirmed Sources project",
        siteUrl: `https://sources-confirmed-${randomUUID()}.example`,
        marketCodes: ["US"],
        siteLanguageCodes: ["en-US"],
        defaultDeliveryLocale: "en",
      },
      safeGuard,
    );
    await seedConfirmedSourceProfile(
      handle,
      { workspaceId, projectId: confirmed.project.id },
      actorId,
    );

    const confirmedSources = await listProjectSources(
      { workspaceId },
      confirmed.project.id,
    );
    expect(confirmedSources.map((slot) => slot.provider)).toEqual([
      "crawl",
      "gsc",
      "ga4",
      "csv",
      "dataforseo",
    ]);
    expect(confirmedSources.find((slot) => slot.provider === "crawl")).toMatchObject({
      id: expect.any(String),
      projectId: confirmed.project.id,
    });
  });
});
