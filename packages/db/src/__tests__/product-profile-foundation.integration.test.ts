import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDbHandle, type DbHandle } from "../client.ts";
import { contentHash } from "../hash.ts";
import { runMigrations } from "../migrate.ts";
import { ProjectsRepository } from "../repositories/projects.ts";
import {
  clientProjects,
  icpProfiles,
  sites,
  workspaces,
} from "../schema.ts";

const DATABASE_URL = process.env["DATABASE_URL"];
const describeDb = DATABASE_URL ? describe : describe.skip;

function pgCode(error: unknown): string | undefined {
  let candidate = error;
  for (let depth = 0; depth < 6; depth += 1) {
    if (typeof candidate !== "object" || candidate === null) return undefined;
    const wrapped = candidate as { code?: unknown; cause?: unknown };
    if (typeof wrapped.code === "string") return wrapped.code;
    candidate = wrapped.cause;
  }
  return undefined;
}

async function expectPgCode(
  promise: Promise<unknown>,
  code: string,
): Promise<void> {
  await expect(promise).rejects.toSatisfy(
    (error: unknown) => pgCode(error) === code,
  );
}

describeDb("product profile foundation", () => {
  let handle: DbHandle;

  beforeAll(async () => {
    await runMigrations(DATABASE_URL!);
    handle = createDbHandle(DATABASE_URL!);
  });

  afterAll(async () => {
    await handle?.end();
  });

  it("keeps confirmed v1 while current advances to draft v2 and accepts unknown site scope", async () => {
    const actorId = randomUUID();
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `Product profile ${randomUUID()}` })
      .returning();
    const workspaceId = workspace!.id;
    const scope = { workspaceId };
    const projects = new ProjectsRepository(handle.db);
    const project = await projects.insert({
      workspaceId,
      clientName: "Profile client",
      projectName: "Profile project",
      defaultDeliveryLocale: "en",
      createdBy: actorId,
    });

    const siteHost = `${randomUUID()}.example.test`;
    const [site] = await handle.db
      .insert(sites)
      .values({
        workspace_id: workspaceId,
        project_id: project.id,
        origin: `https://${siteHost}`,
        host: siteHost,
        market_codes: [],
        language_codes: [],
      })
      .returning();
    expect(site).toMatchObject({ market_codes: [], language_codes: [] });

    const completeV1Profile = { productName: "Confirmed v1" };
    const [completeV1] = await handle.db
      .insert(icpProfiles)
      .values({
        workspace_id: workspaceId,
        project_id: project.id,
        version: 1,
        status: "complete",
        profile: completeV1Profile,
        content_hash: contentHash({
          status: "complete",
          profile: completeV1Profile,
        }),
        created_by: actorId,
      })
      .returning();
    await expect(
      projects.setCurrentIcpProfile(scope, project.id, completeV1!.id),
    ).resolves.toBe(true);
    await expect(
      projects.setConfirmedIcpProfile(scope, project.id, completeV1!.id),
    ).resolves.toBe(true);

    const draftV2Profile = { productName: "Working v2" };
    const [draftV2] = await handle.db
      .insert(icpProfiles)
      .values({
        workspace_id: workspaceId,
        project_id: project.id,
        version: 2,
        status: "draft",
        profile: draftV2Profile,
        content_hash: contentHash({
          status: "draft",
          profile: draftV2Profile,
        }),
        created_by: actorId,
      })
      .returning();
    await expect(
      projects.setCurrentIcpProfile(scope, project.id, draftV2!.id),
    ).resolves.toBe(true);

    await expect(
      projects.findConfirmedIcpProfile(scope, project.id),
    ).resolves.toMatchObject({
      id: completeV1!.id,
      version: 1,
      status: "complete",
    });
    await expect(
      projects.findConfirmedIcpProfile(
        { workspaceId: randomUUID() },
        project.id,
      ),
    ).resolves.toBeNull();

    const persisted = await projects.findById(scope, project.id);
    expect(persisted).toMatchObject({
      stage: "setup",
      current_icp_profile_id: draftV2!.id,
      confirmed_icp_profile_id: completeV1!.id,
    });
    await expect(
      projects.setCurrentIcpProfile(scope, randomUUID(), draftV2!.id),
    ).resolves.toBe(false);
    await expect(
      projects.setConfirmedIcpProfile(
        scope,
        randomUUID(),
        completeV1!.id,
      ),
    ).resolves.toBe(false);
  });

  it("rejects cross-project profile splices and a draft confirmed pointer", async () => {
    const actorId = randomUUID();
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `Profile provenance ${randomUUID()}` })
      .returning();
    const [otherWorkspace] = await handle.db
      .insert(workspaces)
      .values({ name: `Other profile provenance ${randomUUID()}` })
      .returning();
    const workspaceId = workspace!.id;
    const scope = { workspaceId };
    const projects = new ProjectsRepository(handle.db);
    const projectA = await projects.insert({
      workspaceId,
      clientName: "Client A",
      projectName: "Project A",
      defaultDeliveryLocale: "en",
      createdBy: actorId,
    });
    const projectB = await projects.insert({
      workspaceId,
      clientName: "Client B",
      projectName: "Project B",
      defaultDeliveryLocale: "en",
      createdBy: actorId,
    });
    const draftAProfile = { fixture: "draft-a" };
    const completeBProfile = { fixture: "complete-b" };
    const wrongWorkspaceAProfile = { fixture: "wrong-workspace-a" };
    const [draftA, completeB, wrongWorkspaceA] = await handle.db
      .insert(icpProfiles)
      .values([
        {
          workspace_id: workspaceId,
          project_id: projectA.id,
          version: 1,
          status: "draft" as const,
          profile: draftAProfile,
          content_hash: contentHash({
            status: "draft",
            profile: draftAProfile,
          }),
          created_by: actorId,
        },
        {
          workspace_id: workspaceId,
          project_id: projectB.id,
          version: 1,
          status: "complete" as const,
          profile: completeBProfile,
          content_hash: contentHash({
            status: "complete",
            profile: completeBProfile,
          }),
          created_by: actorId,
        },
        {
          workspace_id: otherWorkspace!.id,
          project_id: projectA.id,
          version: 2,
          status: "complete" as const,
          profile: wrongWorkspaceAProfile,
          content_hash: contentHash({
            status: "complete",
            profile: wrongWorkspaceAProfile,
          }),
          created_by: actorId,
        },
      ])
      .returning();

    await expectPgCode(
      projects.setCurrentIcpProfile(scope, projectA.id, completeB!.id),
      "23514",
    );
    await expectPgCode(
      projects.setConfirmedIcpProfile(scope, projectA.id, completeB!.id),
      "23514",
    );
    await expectPgCode(
      projects.setCurrentIcpProfile(
        scope,
        projectA.id,
        wrongWorkspaceA!.id,
      ),
      "23514",
    );
    await expectPgCode(
      projects.setConfirmedIcpProfile(
        scope,
        projectA.id,
        wrongWorkspaceA!.id,
      ),
      "23514",
    );
    await expectPgCode(
      projects.setConfirmedIcpProfile(scope, projectA.id, draftA!.id),
      "23514",
    );
    await expect(
      projects.findById(scope, projectA.id),
    ).resolves.toMatchObject({
      current_icp_profile_id: null,
      confirmed_icp_profile_id: null,
      stage: "setup",
    });
  });

  it("preserves append-only ICP rows and enforces both pointer FKs on delete", async () => {
    const actorId = randomUUID();
    const [workspace] = await handle.db
      .insert(workspaces)
      .values({ name: `Profile restrict ${randomUUID()}` })
      .returning();
    const scope = { workspaceId: workspace!.id };
    const projects = new ProjectsRepository(handle.db);
    const project = await projects.insert({
      workspaceId: workspace!.id,
      clientName: "Restrict client",
      projectName: "Restrict project",
      defaultDeliveryLocale: "en",
      createdBy: actorId,
    });
    const completeV1Profile = { fixture: "restrict-complete" };
    const draftV2Profile = { fixture: "restrict-draft" };
    const [completeV1, draftV2] = await handle.db
      .insert(icpProfiles)
      .values([
        {
          workspace_id: workspace!.id,
          project_id: project.id,
          version: 1,
          status: "complete" as const,
          profile: completeV1Profile,
          content_hash: contentHash({
            status: "complete",
            profile: completeV1Profile,
          }),
          created_by: actorId,
        },
        {
          workspace_id: workspace!.id,
          project_id: project.id,
          version: 2,
          status: "draft" as const,
          profile: draftV2Profile,
          content_hash: contentHash({
            status: "draft",
            profile: draftV2Profile,
          }),
          created_by: actorId,
        },
      ])
      .returning();
    await projects.setCurrentIcpProfile(scope, project.id, draftV2!.id);
    await projects.setConfirmedIcpProfile(
      scope,
      project.id,
      completeV1!.id,
    );

    await expectPgCode(
      handle.db
        .update(icpProfiles)
        .set({ profile: { mutated: true } })
        .where(eq(icpProfiles.id, draftV2!.id)),
      "55000",
    );
    await expectPgCode(
      handle.db
        .delete(icpProfiles)
        .where(eq(icpProfiles.id, completeV1!.id)),
      "55000",
    );

    const client = await handle.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "ALTER TABLE app.icp_profiles DISABLE TRIGGER icp_profiles_append_only",
      );
      for (const profileId of [completeV1!.id, draftV2!.id]) {
        await client.query("SAVEPOINT before_profile_delete");
        await expectPgCode(
          client.query("DELETE FROM app.icp_profiles WHERE id = $1", [
            profileId,
          ]),
          "23503",
        );
        await client.query("ROLLBACK TO SAVEPOINT before_profile_delete");
      }
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }

    const [row] = await handle.db
      .select({
        current: clientProjects.current_icp_profile_id,
        confirmed: clientProjects.confirmed_icp_profile_id,
      })
      .from(clientProjects)
      .where(
        and(
          eq(clientProjects.workspace_id, workspace!.id),
          eq(clientProjects.id, project.id),
        ),
      );
    expect(row).toEqual({ current: draftV2!.id, confirmed: completeV1!.id });
  });
});
