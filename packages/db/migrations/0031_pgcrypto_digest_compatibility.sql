BEGIN;

-- Supabase installs pgcrypto in its managed `extensions` schema. Historical
-- migrations and trigger functions intentionally use a narrow app/public
-- search_path, so expose only the two pgcrypto digest overloads they require in
-- public. A stock PostgreSQL install already owns these signatures in public
-- and must remain untouched.
DO $migration$
DECLARE
  pgcrypto_extension_oid oid;
  pgcrypto_namespace_oid oid;
  pgcrypto_schema name;
  extension_digest_count integer;
  restricted_role name;
BEGIN
  SELECT
    extension_row.oid,
    extension_namespace.oid,
    extension_namespace.nspname
  INTO
    pgcrypto_extension_oid,
    pgcrypto_namespace_oid,
    pgcrypto_schema
  FROM pg_catalog.pg_extension extension_row
  JOIN pg_catalog.pg_namespace extension_namespace
    ON extension_namespace.oid = extension_row.extnamespace
  WHERE extension_row.extname = 'pgcrypto';

  IF pgcrypto_extension_oid IS NULL THEN
    RAISE EXCEPTION 'pgcrypto extension is required for digest compatibility'
      USING ERRCODE = '55000';
  END IF;

  SELECT count(*)
  INTO extension_digest_count
  FROM pg_catalog.pg_proc procedure
  JOIN pg_catalog.pg_depend dependency
    ON dependency.classid =
         'pg_catalog.pg_proc'::pg_catalog.regclass
   AND dependency.objid = procedure.oid
   AND dependency.refclassid =
         'pg_catalog.pg_extension'::pg_catalog.regclass
   AND dependency.refobjid = pgcrypto_extension_oid
   AND dependency.deptype = 'e'
  WHERE procedure.pronamespace = pgcrypto_namespace_oid
    AND procedure.oid IN (
      pg_catalog.to_regprocedure(
        pg_catalog.format('%I.digest(bytea,text)', pgcrypto_schema)
      ),
      pg_catalog.to_regprocedure(
        pg_catalog.format('%I.digest(text,text)', pgcrypto_schema)
      )
    );

  IF extension_digest_count <> 2 THEN
    RAISE EXCEPTION 'pgcrypto digest overloads are incomplete'
      USING ERRCODE = '55000';
  END IF;

  IF pgcrypto_schema = 'extensions' THEN
    EXECUTE $function$
      CREATE OR REPLACE FUNCTION public.digest(
        data bytea,
        algorithm text
      )
      RETURNS bytea
      LANGUAGE sql
      IMMUTABLE
      STRICT
      PARALLEL SAFE
      SECURITY INVOKER
      SET search_path = pg_catalog
      AS 'SELECT extensions.digest($1, $2)'
    $function$;

    EXECUTE $function$
      CREATE OR REPLACE FUNCTION public.digest(
        data text,
        algorithm text
      )
      RETURNS bytea
      LANGUAGE sql
      IMMUTABLE
      STRICT
      PARALLEL SAFE
      SECURITY INVOKER
      SET search_path = pg_catalog
      AS 'SELECT extensions.digest($1, $2)'
    $function$;

    REVOKE EXECUTE ON FUNCTION public.digest(bytea, text) FROM PUBLIC;
    REVOKE EXECUTE ON FUNCTION public.digest(text, text) FROM PUBLIC;

    FOR restricted_role IN
      SELECT role_row.rolname
      FROM pg_catalog.pg_roles role_row
      WHERE role_row.rolname IN ('anon', 'authenticated', 'service_role')
    LOOP
      EXECUTE pg_catalog.format(
        'REVOKE EXECUTE ON FUNCTION public.digest(bytea, text) FROM %I',
        restricted_role
      );
      EXECUTE pg_catalog.format(
        'REVOKE EXECUTE ON FUNCTION public.digest(text, text) FROM %I',
        restricted_role
      );
    END LOOP;

    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_roles role_row
      WHERE role_row.rolname = 'postgres'
    ) THEN
      GRANT EXECUTE ON FUNCTION public.digest(bytea, text) TO postgres;
      GRANT EXECUTE ON FUNCTION public.digest(text, text) TO postgres;
    END IF;
  ELSIF pgcrypto_schema = 'public' THEN
    -- A stock PostgreSQL pgcrypto installation already provides both exact
    -- extension-owned overloads on the runtime search path.
    NULL;
  ELSE
    RAISE EXCEPTION 'unsupported pgcrypto extension schema'
      USING ERRCODE = '55000';
  END IF;
END;
$migration$;

CREATE OR REPLACE VIEW app.schema_migration_version AS
  SELECT '0031_pgcrypto_digest_compatibility'::text AS migration_version;

COMMIT;
