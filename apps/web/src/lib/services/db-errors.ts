const MAX_POSTGRES_CAUSE_DEPTH = 8;

function readProperty(
  value: object,
  property: "code" | "constraint" | "cause",
): unknown {
  try {
    return Reflect.get(value, property);
  } catch {
    return undefined;
  }
}

/**
 * Recognize PostgreSQL unique violations through the short `cause` chains used
 * by database clients and Drizzle wrappers. The inspection is deliberately
 * structural: it never formats the error or reads message/stack/toString, and
 * it stops on cycles, primitives, hostile getters, or the fixed depth bound.
 */
export function isPostgresUniqueViolation(
  error: unknown,
  expectedConstraint?: string | readonly string[],
): boolean {
  let current = error;
  const seen = new Set<object>();

  for (let depth = 0; depth < MAX_POSTGRES_CAUSE_DEPTH; depth += 1) {
    if (
      current === null ||
      (typeof current !== "object" && typeof current !== "function")
    ) {
      return false;
    }

    const object = current as object;
    if (seen.has(object)) return false;
    seen.add(object);

    if (readProperty(object, "code") === "23505") {
      if (expectedConstraint === undefined) return true;
      const constraint = readProperty(object, "constraint");
      if (
        typeof constraint === "string" &&
        (typeof expectedConstraint === "string"
          ? constraint === expectedConstraint
          : expectedConstraint.includes(constraint))
      ) {
        return true;
      }
    }
    current = readProperty(object, "cause");
  }

  return false;
}
