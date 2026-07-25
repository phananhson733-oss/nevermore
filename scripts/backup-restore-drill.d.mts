/**
 * Hand-written declarations for the restore drill's pure SQL-building surface,
 * so the Postgres-backed integration test can execute the exact statements the
 * drill sends instead of a hand-copied approximation of them.
 *
 * `runRestoreDrill` is intentionally not declared: it spawns PostgreSQL client
 * processes and creates databases, and nothing under `packages/` may call it.
 */

export interface IntegrityProbe {
  readonly id: string;
  readonly table: string;
  readonly key: readonly string[];
  readonly columns: readonly string[];
}

export declare const APP_TABLES: string[];
export declare const INTEGRITY_PROBES: IntegrityProbe[];

export declare function buildTableCountSql(): string;
export declare function buildCanonicalCopySql(table: string): string;
export declare function buildIntegrityCopySql(probe: IntegrityProbe): string;
export declare function extractSchemaReferences(sqlText: string): {
  tables: string[];
  columns: string[];
};
