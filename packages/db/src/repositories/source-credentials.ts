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

  /** Erase the credential on disconnect (ciphertext cleared immediately, §12.3). */
  async deleteByConnection(sourceConnectionId: string): Promise<void> {
    await this.exec
      .delete(sourceCredentials)
      .where(eq(sourceCredentials.source_connection_id, sourceConnectionId));
  }
}
