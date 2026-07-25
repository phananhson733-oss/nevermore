/**
 * Which of the project's data sources are actually connected.
 *
 * `listProjectSources` always answers with one row per provider, so the array
 * length says nothing and the `state` word is the only real signal. The rail
 * used to count `state === "connected"` alone, which is wrong in the direction
 * that under-reports: a source only sits at `connected` between the handshake
 * and its first collection. Once it has delivered anything it moves on to
 * `syncing` / `available` / `partial` / `stale`, and a project whose sources
 * were all working therefore read "no connected sources for this project".
 *
 * The predicate below follows the column the database actually keys on:
 * `source_connections` carries `CHECK ((state = 'disconnected') = (disconnected_at IS NOT NULL))`,
 * so every state except `disconnected` describes a connection that exists.
 * `connecting` is excluded on top of that — it is the one in-flight handshake
 * state, and reporting it would claim a connection that has not been made — and
 * so is a provider slot with no connection row at all (`id === null`), which the
 * mapper reports as `disconnected` anyway.
 */

export interface ConnectableSource {
  readonly id: string | null;
  readonly provider: string;
  readonly state: string;
}

/** States that mean "there is no connection here (yet)". */
const NOT_CONNECTED_STATES: ReadonlySet<string> = new Set([
  "disconnected",
  "connecting",
]);

export function isConnectedSource(source: ConnectableSource): boolean {
  return source.id !== null && !NOT_CONNECTED_STATES.has(source.state);
}

/**
 * The providers this project has connected, in the order the API returned them.
 *
 * Providers, not a count: "which sources" is the question a reviewer asks of
 * this row, and a bare number cannot answer it.
 */
export function connectedSourceProviders(
  sources: readonly ConnectableSource[],
): readonly string[] {
  const seen = new Set<string>();
  const providers: string[] = [];
  for (const source of sources) {
    if (!isConnectedSource(source)) continue;
    if (seen.has(source.provider)) continue;
    seen.add(source.provider);
    providers.push(source.provider);
  }
  return providers;
}
