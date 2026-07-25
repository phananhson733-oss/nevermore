/**
 * Hand-written declarations for the database-free schema catalog so the
 * Postgres-backed integration test can cross-check the parser against a real
 * server without the parser itself moving into a TypeScript package.
 */

export declare const MIGRATIONS_DIRECTORY: string;
export declare const CATALOG_SCHEMA: "app";

export interface SchemaCatalogTable {
  readonly table: string;
  readonly columns: Set<string>;
  readonly primaryKey: string[] | null;
  readonly definedBy: string;
}

export type SchemaCatalog = Map<string, SchemaCatalogTable>;

export interface SchemaReferences {
  readonly tables: readonly string[];
  readonly columns: readonly string[];
}

export declare function scanSql(text: string): { ddl: string; hidden: string };

export declare function buildSchemaCatalog(
  migrations: readonly { readonly name: string; readonly sql: string }[],
): SchemaCatalog;

export declare function listMigrationFiles(): Promise<string[]>;

export declare function loadSchemaCatalog(): Promise<SchemaCatalog>;

export declare function missingSchemaReferences(
  catalog: SchemaCatalog,
  references: SchemaReferences,
): string[];
