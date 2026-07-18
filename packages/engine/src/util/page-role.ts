import { subjectUrlOf } from "@sf/sources";

/**
 * `page_role.v1` (spec §8.4). A page is `commercial` when its canonical subjectUrl
 * is an ICP priorityUrl (exact/normalized) OR its path matches the fixed
 * commercial path pattern. This is an inferred (grade C) classification.
 */

export const PAGE_ROLE_VERSION = "page_role.v1";

const COMMERCIAL_PATH =
  /\/(pricing|product|products|service|services|solution|solutions|features|demo|trial|signup|contact|shop|cart)(\/|$)/i;

/** Canonical subjectUrls of the ICP priorityUrls (dropping any that won't parse). */
export function priorityUrlSet(priorityUrls: readonly string[]): Set<string> {
  const set = new Set<string>();
  for (const raw of priorityUrls) {
    const subject = subjectUrlOf(raw);
    if (subject) set.add(subject);
  }
  return set;
}

export function isPriorityUrl(subjectUrl: string, prioritySet: ReadonlySet<string>): boolean {
  return prioritySet.has(subjectUrl);
}

/** Whether a page counts as commercial/priority (spec §8.4 page_role.v1). */
export function isCommercialUrl(
  subjectUrl: string,
  prioritySet: ReadonlySet<string>,
): boolean {
  if (prioritySet.has(subjectUrl)) return true;
  try {
    const path = new URL(subjectUrl).pathname;
    return COMMERCIAL_PATH.test(path);
  } catch {
    return false;
  }
}
