// @input -- bounded v2 JSON values, including safe integer metadata
// @output -- deterministic canonical text and actual PostgreSQL JSONB text size
// @pos -- client-safe v2 encoding; never changes the legacy hash algorithm
export function canonicalGeoV2Text(value: unknown): string {
  if (value === null || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "string") {
    if (value.includes("\u0000")) throw new Error("JSONB cannot store NUL");
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new Error("GEO v2 metadata must be safe integers");
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalGeoV2Text).join(",")}]`;
  if (typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) throw new Error("Expected plain JSON");
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map(key => `${canonicalGeoV2Text(key)}:${canonicalGeoV2Text(record[key])}`).join(",")}}`;
}

export function geoV2JsonbBytes(value: unknown): number {
  const canonicalBytes = new TextEncoder().encode(canonicalGeoV2Text(value)).byteLength;
  const spaces = (node: unknown): number => {
    if (Array.isArray(node)) return Math.max(0, node.length - 1) + node.reduce<number>((sum, entry) => sum + spaces(entry), 0);
    if (node === null || typeof node !== "object") return 0;
    const entries = Object.values(node);
    return entries.length + Math.max(0, entries.length - 1) + entries.reduce<number>((sum, entry) => sum + spaces(entry), 0);
  };
  return canonicalBytes + spaces(value);
}
