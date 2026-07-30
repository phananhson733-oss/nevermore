// @input  -- public Supabase environment values and a PostgREST error code
// @output -- narrow availability checks for optional server-side consent telemetry
// @pos    -- keeps cookie preferences functional when marketing persistence is not configured

export interface ConsentPersistenceEnvironment {
  readonly NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  readonly NEXT_PUBLIC_SUPABASE_URL?: string;
}

export function hasConsentPersistenceConfig(
  environment: ConsentPersistenceEnvironment,
): boolean {
  return Boolean(
    environment.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
      environment.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
  );
}

export function isConsentStoreUnavailable(errorCode: string | undefined) {
  return errorCode === "PGRST205";
}
