import { randomUUID } from "node:crypto";

// Full web env (fail-fast) — set before any service import touches getEnv().
process.env["APP_ORIGIN"] ??= "http://localhost:3000";
process.env["SUPABASE_URL"] ??= "http://localhost:54321";
process.env["SUPABASE_ANON_KEY"] ??= "test-anon";
process.env["SUPABASE_SERVICE_ROLE_KEY"] ??= "test-service-role";
process.env["CREDENTIAL_ENCRYPTION_KEY"] ??=
  Buffer.alloc(32).toString("base64");
process.env["GOOGLE_OAUTH_CLIENT_ID"] ??= "test-client-id";
process.env["GOOGLE_OAUTH_CLIENT_SECRET"] ??= "test-client-secret";
process.env["DATAFORSEO_ENABLED"] ??= "false";
process.env["RAW_IMPORT_BUCKET"] ??= "raw-imports";
process.env["EXPORT_BUCKET"] ??= "exports";
process.env["LOG_LEVEL"] ??= "error";

import { createDbHandle, type DbHandle } from "@sf/db/client";
import { workspaces } from "@sf/db/schema";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  archiveProject,
  createProject,
  type UrlGuard,
} from "@/lib/services/projects";

const DATABASE_URL = process.env["DATABASE_URL"]!;
const describeDb = process.env["DATABASE_URL"] ? describe : describe.skip;

const safeGuard: UrlGuard = async (url) => ({
  safe: true,
  normalizedUrl: url,
  pinnedIp: "93.184.216.34",
  reason: null,
});

const baseBody = (siteUrl: string) => ({
  clientName: "Acme",
  projectName: "Acme SEO",
  siteUrl,
  marketCodes: ["US"],
  siteLanguageCodes: ["en"],
  defaultDeliveryLocale: "en",
});

/**
 * The free-tier ceiling, against real PostgreSQL.
 *
 * The unit test drives a hand-written fake transaction, so it can only assert
 * that the code ASKED for `FOR UPDATE` and counted with an `archived_at IS NULL`
 * predicate. Whether those actually bound anything is a property of Postgres,
 * not of the fake — which is why this suite exists.
 *
 * It also pins the two things the tier is easy to get wrong in opposite
 * directions: a ceiling that never admits the first project, and a ceiling that
 * counts archived rows and so means "one project EVER" rather than "one at a
 * time".
 */
describeDb("free-tier project ceiling", () => {
  let handle: DbHandle;
  const actor = randomUUID();

  beforeAll(() => {
    handle = createDbHandle(DATABASE_URL);
  });
  afterAll(async () => {
    await handle?.end();
  });

  async function newWorkspace(planTier: string): Promise<string> {
    const [ws] = await handle.db
      .insert(workspaces)
      .values({ name: `WS-${randomUUID()}`, plan_tier: planTier })
      .returning();
    return ws!.id;
  }

  it("admits the first project, refuses the second, and admits again after archiving", async () => {
    const scope = { workspaceId: await newWorkspace("free") };

    const first = await createProject(
      scope,
      actor,
      randomUUID(),
      baseBody("https://one.example"),
      safeGuard,
    );
    expect(first.status).toBe(201);

    await expect(
      createProject(
        scope,
        actor,
        randomUUID(),
        baseBody("https://two.example"),
        safeGuard,
      ),
    ).rejects.toMatchObject({ code: "PLAN_LIMIT_REACHED" });

    // Archiving is the product's own "done with this one" affordance. If it did
    // not free the slot, the free tier would be one project ever.
    await archiveProject(scope, first.project.id);

    const second = await createProject(
      scope,
      actor,
      randomUUID(),
      baseBody("https://two.example"),
      safeGuard,
    );
    expect(second.status).toBe(201);
  });

  it("leaves the internal tier unbounded", async () => {
    const scope = { workspaceId: await newWorkspace("internal") };

    for (const host of ["a.example", "b.example", "c.example"]) {
      const result = await createProject(
        scope,
        actor,
        randomUUID(),
        baseBody(`https://${host}`),
        safeGuard,
      );
      expect(result.status).toBe(201);
    }
  });

  it("defaults a workspace nobody labelled to the bounded tier", async () => {
    // The migration sets the column default to 'free' precisely so an
    // unlabelled INSERT from any future code path lands in the bounded tier.
    const [ws] = await handle.db
      .insert(workspaces)
      .values({ name: `WS-${randomUUID()}` })
      .returning({ id: workspaces.id, planTier: workspaces.plan_tier });

    expect(ws!.planTier).toBe("free");
  });
});
