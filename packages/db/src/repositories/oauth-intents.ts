import { and, eq, sql } from "drizzle-orm";
import { oauthIntents } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";

/**
 * `oauth_intents` backs the strict three-phase Google OAuth connect flow (spec
 * §7.4). The DB stores ONLY a state hash and an ENCRYPTED PKCE verifier (and,
 * after callback, an encrypted temporary token) — never plaintext secrets, never
 * in URLs/logs (§14.3). An intent is single-use: `consumed` after property
 * selection, `failed` on any recoverable error. Nothing is written as a
 * half-connected SourceConnection.
 */

export type OAuthIntentStatus =
  | "initiated"
  | "properties_ready"
  | "consumed"
  | "failed";

export interface OAuthIntentRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly initiated_by: string;
  readonly provider: string;
  readonly state_hash: Buffer;
  readonly pkce_verifier_cipher: Buffer;
  readonly token_cipher: Buffer | null;
  readonly candidate_properties: unknown[] | null;
  readonly redirect_path: string;
  readonly status: string;
  readonly failure_code: string | null;
  readonly expires_at: string;
  readonly consumed_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export class OAuthIntentsRepository extends Repository {
  /** Create a 10-minute intent (phase=authorize). */
  async insert(values: {
    workspaceId: string;
    projectId: string;
    siteId: string;
    initiatedBy: string;
    provider: string;
    stateHash: Buffer;
    pkceVerifierCipher: Buffer;
    redirectPath: string;
    expiresAt: string;
  }): Promise<OAuthIntentRow> {
    const [row] = await this.exec
      .insert(oauthIntents)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_id: values.siteId,
        initiated_by: values.initiatedBy,
        provider: values.provider,
        state_hash: values.stateHash,
        pkce_verifier_cipher: values.pkceVerifierCipher,
        redirect_path: values.redirectPath,
        expires_at: values.expiresAt,
      })
      .returning();
    return row as OAuthIntentRow;
  }

  /** An intent by id, project-scoped (property-selection phase). */
  async findById(scope: ProjectScope, id: string): Promise<OAuthIntentRow | null> {
    const rows = await this.exec
      .select()
      .from(oauthIntents)
      .where(and(projectPredicate(oauthIntents, scope), eq(oauthIntents.id, id)))
      .limit(1);
    return (rows[0] as OAuthIntentRow | undefined) ?? null;
  }

  /**
   * The still-live intent matching a callback state hash (workspace-scoped by the
   * caller). Must be unconsumed and unexpired; otherwise the caller returns a
   * replay/expired error. Callback is the one GET that consumes external state.
   */
  async findLiveByStateHash(
    workspaceId: string,
    provider: string,
    stateHash: Buffer,
  ): Promise<OAuthIntentRow | null> {
    const rows = await this.exec
      .select()
      .from(oauthIntents)
      .where(
        and(
          eq(oauthIntents.workspace_id, workspaceId),
          eq(oauthIntents.provider, provider),
          eq(oauthIntents.state_hash, stateHash),
        ),
      )
      .limit(1);
    return (rows[0] as OAuthIntentRow | undefined) ?? null;
  }

  /** After callback: store the encrypted token + candidate properties. */
  async setPropertiesReady(
    id: string,
    values: { tokenCipher: Buffer; candidateProperties: unknown[] },
  ): Promise<void> {
    await this.exec
      .update(oauthIntents)
      .set({
        token_cipher: values.tokenCipher,
        candidate_properties: values.candidateProperties,
        status: "properties_ready",
        updated_at: sql`now()`,
      })
      .where(eq(oauthIntents.id, id));
  }

  /** Mark the intent consumed once the SourceConnection + credential are created. */
  async consume(id: string): Promise<void> {
    await this.exec
      .update(oauthIntents)
      .set({ status: "consumed", consumed_at: sql`now()`, updated_at: sql`now()` })
      .where(eq(oauthIntents.id, id));
  }

  /** Mark a recoverable failure (no half-connected source is created). */
  async fail(id: string, failureCode: string): Promise<void> {
    await this.exec
      .update(oauthIntents)
      .set({ status: "failed", failure_code: failureCode, updated_at: sql`now()` })
      .where(eq(oauthIntents.id, id));
  }
}
