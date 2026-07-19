import { and, eq } from "drizzle-orm";
import { sourceCredentials } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";

/**
 * `source_credentials` stores AES-256-GCM ciphertext for Google tokens (spec
 * §14.3). Plaintext never touches the DB; the API/UI only surface scopes,
 * property, connectedAt and expiry health — never the token or ciphertext.
 * Disconnect clears the ciphertext immediately (§12.3) while snapshots remain.
 */

export interface SourceCredentialRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly source_connection_id: string;
  readonly cipher_version: number;
  readonly encrypted_payload: Buffer;
  readonly key_version: string;
  readonly expires_at: string | null;
}

export class SourceCredentialsRepository extends Repository {
  /**
   * Replace the credential for a connection (re-auth or intent→credential
   * promotion): delete any existing row, then insert the new ciphertext, in the
   * caller's transaction.
   */
  async replace(values: {
    workspaceId: string;
    projectId: string;
    sourceConnectionId: string;
    encryptedPayload: Buffer;
    keyVersion: string;
    cipherVersion?: number;
    expiresAt: string | null;
  }): Promise<SourceCredentialRow> {
    await this.exec
      .delete(sourceCredentials)
      .where(eq(sourceCredentials.source_connection_id, values.sourceConnectionId));
    const [row] = await this.exec
      .insert(sourceCredentials)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        source_connection_id: values.sourceConnectionId,
        encrypted_payload: values.encryptedPayload,
        key_version: values.keyVersion,
        ...(values.cipherVersion ? { cipher_version: values.cipherVersion } : {}),
        expires_at: values.expiresAt,
      })
      .returning();
    return row as SourceCredentialRow;
  }

  /** The credential ciphertext for a connection, project-scoped (worker sync). */
  async findByConnection(
    scope: ProjectScope,
    sourceConnectionId: string,
  ): Promise<SourceCredentialRow | null> {
    const rows = await this.exec
      .select()
      .from(sourceCredentials)
      .where(
        and(
          projectPredicate(sourceCredentials, scope),
          eq(sourceCredentials.source_connection_id, sourceConnectionId),
        ),
      )
      .limit(1);
    return (rows[0] as SourceCredentialRow | undefined) ?? null;
  }

  /**
   * Lock one credential row for an OAuth refresh. The caller MUST use a DB
   * transaction and hold it through the provider refresh + `updateAfterRefresh`.
   * Waiting transactions then observe the winner's fresh ciphertext instead of
   * issuing a second refresh grant.
   */
  async findByConnectionForUpdate(
    scope: ProjectScope,
    sourceConnectionId: string,
  ): Promise<SourceCredentialRow | null> {
    const rows = await this.exec
      .select()
      .from(sourceCredentials)
      .where(
        and(
          projectPredicate(sourceCredentials, scope),
          eq(sourceCredentials.source_connection_id, sourceConnectionId),
        ),
      )
      .limit(1)
      .for("update");
    return (rows[0] as SourceCredentialRow | undefined) ?? null;
  }

  /** Update the row already locked by `findByConnectionForUpdate` in place. */
  async updateAfterRefresh(values: {
    scope: ProjectScope;
    credentialId: string;
    sourceConnectionId: string;
    encryptedPayload: Buffer;
    keyVersion: string;
    cipherVersion: number;
    expiresAt: string;
  }): Promise<SourceCredentialRow | null> {
    const rows = await this.exec
      .update(sourceCredentials)
      .set({
        encrypted_payload: values.encryptedPayload,
        key_version: values.keyVersion,
        cipher_version: values.cipherVersion,
        expires_at: values.expiresAt,
      })
      .where(
        and(
          projectPredicate(sourceCredentials, values.scope),
          eq(sourceCredentials.id, values.credentialId),
          eq(
            sourceCredentials.source_connection_id,
            values.sourceConnectionId,
          ),
        ),
      )
      .returning();
    return (rows[0] as SourceCredentialRow | undefined) ?? null;
  }

  /** Erase the credential on disconnect (ciphertext cleared immediately, §12.3). */
  async deleteByConnection(sourceConnectionId: string): Promise<void> {
    await this.exec
      .delete(sourceCredentials)
      .where(eq(sourceCredentials.source_connection_id, sourceConnectionId));
  }
}
