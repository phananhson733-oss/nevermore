/**
 * Competitors are governed entities with their own public SubjectRef kind.
 * Evidence carries the immutable entity UUID, never a mutable domain label or
 * an identifier recovered from human-readable claim prose.
 */
const COMPETITOR_ENTITY_SUBJECT_PREFIX = "competitor:";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export function competitorEntitySubjectRef(
  competitorEntityId: string,
): string {
  if (!UUID_PATTERN.test(competitorEntityId)) {
    throw new TypeError("invalid competitor entity id");
  }
  return `${COMPETITOR_ENTITY_SUBJECT_PREFIX}${competitorEntityId}`;
}

/**
 * Decode only the canonical typed form. Legacy/namespaced `site:*` encodings
 * are deliberately rejected so a competitor never masquerades as a Site.
 */
export function competitorEntityIdFromSubjectRef(
  subjectRef: string,
): string | null {
  if (!subjectRef.startsWith(COMPETITOR_ENTITY_SUBJECT_PREFIX)) return null;
  const competitorEntityId = subjectRef.slice(
    COMPETITOR_ENTITY_SUBJECT_PREFIX.length,
  );
  return UUID_PATTERN.test(competitorEntityId) ? competitorEntityId : null;
}
