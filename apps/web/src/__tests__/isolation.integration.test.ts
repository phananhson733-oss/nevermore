import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { projectChildPredicate, type ProjectScope } from "@sf/db";
import { clientProjects, sites, workspaces } from "@sf/db/schema";
import { createDbHandle, type DbHandle } from "@sf/db/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

describeDb("workspace/project isolation (AC-005)", () => {
  let handle: DbHandle;
  const actor = randomUUID();
  let wsA: string;
  let wsB: string;
  let projectA: string;
  let projectB: string;
  let siteAId: string;

  beforeAll(async () => {
    handle = createDbHandle(DATABASE_URL!);
    const [a] = await handle.db.insert(workspaces).values({ name: "WS-A", plan_tier: "internal" }).returning();
    const [b] = await handle.db.insert(workspaces).values({ name: "WS-B", plan_tier: "internal" }).returning();
    wsA = a!.id;
    wsB = b!.id;
    const [pa] = await handle.db
      .insert(clientProjects)
      .values({ workspace_id: wsA, client_name: "A", project_name: "A", default_delivery_locale: "en", created_by: actor })
      .returning();
    const [pb] = await handle.db
      .insert(clientProjects)
      .values({ workspace_id: wsB, client_name: "B", project_name: "B", default_delivery_locale: "en", created_by: actor })
      .returning();
    projectA = pa!.id;
    projectB = pb!.id;
    const [s] = await handle.db
      .insert(sites)
      .values({
        workspace_id: wsA,
        project_id: projectA,
        origin: "https://a.example.com",
        host: "a.example.com",
        market_codes: ["US"],
        language_codes: ["en"],
      })
      .returning();
    siteAId = s!.id;
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("a child read scoped to the wrong project returns nothing (→ 404, not 403)", async () => {
    // Correct scope finds the site.
    const rightScope: ProjectScope = { workspaceId: wsA, projectId: projectA };
    const found = await handle.db
      .select({ id: sites.id })
      .from(sites)
      .where(projectChildPredicate(sites, rightScope, eq(sites.id, siteAId)));
    expect(found).toHaveLength(1);

    // Same child id, but scoped to project B (different workspace) -> no rows.
    const wrongScope: ProjectScope = { workspaceId: wsB, projectId: projectB };
    const leaked = await handle.db
      .select({ id: sites.id })
      .from(sites)
      .where(projectChildPredicate(sites, wrongScope, eq(sites.id, siteAId)));
    expect(leaked).toHaveLength(0);

    // Also blocked when only the workspace mismatches (right project id, wrong ws).
    const wrongWs: ProjectScope = { workspaceId: wsB, projectId: projectA };
    const leaked2 = await handle.db
      .select({ id: sites.id })
      .from(sites)
      .where(projectChildPredicate(sites, wrongWs, eq(sites.id, siteAId)));
    expect(leaked2).toHaveLength(0);
  });

  it("the browser roles (anon/authenticated) cannot read the app schema", async () => {
    const client = handle.pool;
    // Create the Supabase-equivalent roles and re-apply the grant revocations.
    await client.query(`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $$;`);
    await client.query(`REVOKE ALL ON SCHEMA app FROM anon, authenticated`);
    await client.query(`REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon, authenticated`);

    const conn = await client.connect();
    try {
      await conn.query("SET ROLE anon");
      await expect(conn.query("SELECT * FROM app.workspaces LIMIT 1")).rejects.toThrow(
        /permission denied/i,
      );
    } finally {
      await conn.query("RESET ROLE").catch(() => {});
      conn.release();
    }
  });
});
