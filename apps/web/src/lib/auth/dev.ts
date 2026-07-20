/**
 * Local-development auth affordance (NOT a product feature). It activates only
 * for an explicit development runtime whose configured application origin is an
 * exact loopback host. Shared test/staging deployments therefore fail closed even
 * if `SF_DEV_AUTH` is accidentally set (spec §14.1). Edge-safe: no node imports.
 */

/** Fixed synthetic operator id used only under dev auth. */
export const DEV_USER_ID = "00000000-0000-4000-8000-000000000001";
export const DEV_USER_NAME = "Local Dev Operator";

export type RuntimeEnvironment = Readonly<
  Record<string, string | undefined>
>;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** True only for an explicit Next development process on an exact loopback origin. */
export function isLoopbackDevelopmentRuntime(
  env: RuntimeEnvironment,
): boolean {
  if (env["NODE_ENV"] !== "development") return false;
  const appOrigin = env["APP_ORIGIN"];
  if (!appOrigin) return false;

  try {
    const url = new URL(appOrigin);
    return (
      (url.protocol === "http:" || url.protocol === "https:") &&
      url.username === "" &&
      url.password === "" &&
      LOOPBACK_HOSTS.has(url.hostname.toLowerCase())
    );
  } catch {
    return false;
  }
}

export function isDevAuthEnabled(
  env: RuntimeEnvironment = process.env,
): boolean {
  return (
    env["SF_DEV_AUTH"] === "true" && isLoopbackDevelopmentRuntime(env)
  );
}
