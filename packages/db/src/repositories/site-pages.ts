import { and, asc, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { sha256Hex } from "../hash.ts";
import { sitePages } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";
import {
  decodeTimestampUuidCursor,
  encodeTimestampUuidCursor,
} from "./cursor.ts";

export interface SitePageRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly site_id: string;
  readonly normalized_url: string;
  readonly normalized_url_hash: string;
  readonly template_key: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface SitePageListPage {
  readonly rows: SitePageRow[];
  readonly nextCursor: string | null;
}

export interface CanonicalSubjectCandidates {
  /** Canonical aggregation identity retained on Observation.subject_ref. */
  readonly subjectRef: string;
  /** Complete bounded set of canonical-equivalent exact fetch identities. */
  readonly exactCandidates: readonly string[];
}

const SITE_PAGE_IDENTITY_QUERY_CHUNK = 500;
export const MAX_SITE_PAGE_ID_LOOKUP = 500;
const MAX_SITE_PAGE_ID_LENGTH = 256;

function assertBoundedUrlIdentity(value: string, label: string): void {
  if (value.length < 1 || value.length > 2048) {
    throw new RangeError(`${label} must contain 1 to 2048 characters`);
  }
}

function assertBoundedSitePageId(value: string): void {
  if (value.trim().length === 0 || value.length > MAX_SITE_PAGE_ID_LENGTH) {
    throw new RangeError(
      `sitePageId must be between 1 and ${MAX_SITE_PAGE_ID_LENGTH} characters`,
    );
  }
}

/** SHA-256 of the exact UTF-8 bytes persisted in `normalized_url`. */
export function normalizedUrlHash(normalizedUrl: string): string {
  return sha256Hex(normalizedUrl);
}

export class SitePagesRepository extends Repository {
  /**
   * Serialize all exact variants of canonical subjects across Crawl, GSC, and
   * GA4 collection commits. Sorting the complete de-duplicated set before
   * chunking establishes one global lock order and prevents deadlocks.
   */
  async lockCanonicalSubjects(
    scope: ProjectScope,
    siteId: string,
    subjectRefs: readonly string[],
  ): Promise<void> {
    const candidates = [...new Set(subjectRefs)].sort();
    for (const subjectRef of candidates) {
      assertBoundedUrlIdentity(subjectRef, "canonical subject");
    }
    for (
      let offset = 0;
      offset < candidates.length;
      offset += SITE_PAGE_IDENTITY_QUERY_CHUNK
    ) {
      const chunk = candidates.slice(
        offset,
        offset + SITE_PAGE_IDENTITY_QUERY_CHUNK,
      );
      const subjectParams = chunk.map((subjectRef) => sql`${subjectRef}`);
      await this.exec.execute(sql`
        select app.lock_site_page_canonical_subjects(
          ${scope.workspaceId}::uuid,
          ${scope.projectId}::uuid,
          ${siteId}::uuid,
          array[${sql.join(subjectParams, sql`, `)}]::text[]
        )
      `);
    }
  }

  async upsertNormalizedUrl(values: {
    workspaceId: string;
    projectId: string;
    siteId: string;
    normalizedUrl: string;
    templateKey: string | null;
  }): Promise<SitePageRow> {
    const urlHash = normalizedUrlHash(values.normalizedUrl);
    const [row] = await this.exec
      .insert(sitePages)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        site_id: values.siteId,
        normalized_url: values.normalizedUrl,
        normalized_url_hash: urlHash,
        template_key: values.templateKey,
      })
      .onConflictDoUpdate({
        target: [sitePages.project_id, sitePages.normalized_url_hash],
        set: {
          // Crawl materialization has no template knowledge. Treat null as
          // "unknown" on replay so it cannot erase a later page classification;
          // an explicit clearing operation, if added, must use a separate API.
          template_key: sql`coalesce(excluded.template_key, ${sitePages.template_key})`,
        },
        setWhere: and(
          eq(sitePages.workspace_id, values.workspaceId),
          eq(sitePages.site_id, values.siteId),
          eq(sitePages.normalized_url, values.normalizedUrl),
        )!,
      })
      .returning();
    if (
      !row ||
      row.workspace_id !== values.workspaceId ||
      row.project_id !== values.projectId ||
      row.site_id !== values.siteId ||
      row.normalized_url !== values.normalizedUrl ||
      row.normalized_url_hash !== urlHash
    ) {
      throw new Error("site page URL hash conflicts with durable identity");
    }
    return row as SitePageRow;
  }

  async findById(
    scope: ProjectScope,
    id: string,
  ): Promise<SitePageRow | null> {
    const rows = await this.exec
      .select()
      .from(sitePages)
      .where(and(projectPredicate(sitePages, scope), eq(sitePages.id, id)))
      .limit(1);
    return (rows[0] as SitePageRow | undefined) ?? null;
  }

  /** Load one bounded, de-duplicated SitePage set without leaving Project scope. */
  async findByIds(
    scope: ProjectScope,
    ids: readonly string[],
  ): Promise<SitePageRow[]> {
    if (ids.length === 0) return [];
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length > MAX_SITE_PAGE_ID_LOOKUP) {
      throw new RangeError(
        `site page lookup accepts at most ${MAX_SITE_PAGE_ID_LOOKUP} unique IDs`,
      );
    }
    for (const id of uniqueIds) assertBoundedSitePageId(id);
    return (await this.exec
      .select()
      .from(sitePages)
      .where(
        and(
          projectPredicate(sitePages, scope),
          inArray(sitePages.id, uniqueIds),
        ),
      )
      .orderBy(asc(sitePages.id))) as SitePageRow[];
  }

  async findByNormalizedUrlHash(
    scope: ProjectScope,
    normalizedUrlHash: string,
  ): Promise<SitePageRow | null> {
    const rows = await this.exec
      .select()
      .from(sitePages)
      .where(
        and(
          projectPredicate(sitePages, scope),
          eq(sitePages.normalized_url_hash, normalizedUrlHash),
        ),
      )
      .limit(1);
    return (rows[0] as SitePageRow | undefined) ?? null;
  }

  /**
   * Resolve the exact persisted URL bytes for one Site. The hash keeps the
   * indexed lookup cheap, while the URL and Site predicates make a collision
   * or a cross-Site row fail closed instead of becoming durable provenance.
   */
  async findExactNormalizedUrl(
    scope: ProjectScope,
    siteId: string,
    normalizedUrl: string,
  ): Promise<SitePageRow | null> {
    if (normalizedUrl.length < 1 || normalizedUrl.length > 2048) {
      throw new RangeError(
        "normalized URL must contain 1 to 2048 characters",
      );
    }
    const urlHash = normalizedUrlHash(normalizedUrl);
    const rows = await this.exec
      .select()
      .from(sitePages)
      .where(
        and(
          projectPredicate(sitePages, scope),
          eq(sitePages.site_id, siteId),
          eq(sitePages.normalized_url_hash, urlHash),
          eq(sitePages.normalized_url, normalizedUrl),
        ),
      )
      .limit(1);
    const row = rows[0] as SitePageRow | undefined;
    if (!row) return null;
    if (
      row.workspace_id !== scope.workspaceId ||
      row.project_id !== scope.projectId ||
      row.site_id !== siteId ||
      row.normalized_url !== normalizedUrl ||
      row.normalized_url_hash !== urlHash
    ) {
      throw new Error(
        "site page exact URL lookup returned a foreign identity",
      );
    }
    return row;
  }

  /**
   * Resolve canonical analytics subjects only after acquiring the same locks
   * used by exact Crawl materialization. Zero variants creates the canonical
   * subject as a SitePage, one binds that exact row, and multiple remain null.
   * The caller derives `exactCandidates` with canonical_url.v1; this repository
   * validates bounded cardinality and durable identity but never guesses.
   */
  async resolveUnambiguousCanonicalSubjects(
    scope: ProjectScope,
    siteId: string,
    subjects: readonly CanonicalSubjectCandidates[],
  ): Promise<ReadonlyMap<string, SitePageRow | null>> {
    const bySubject = new Map<string, readonly string[]>();
    const candidateOwner = new Map<string, string>();
    for (const subject of subjects) {
      assertBoundedUrlIdentity(subject.subjectRef, "canonical subject");
      if (bySubject.has(subject.subjectRef)) {
        throw new Error("duplicate canonical subject resolution request");
      }
      const exactCandidates = [...new Set(subject.exactCandidates)];
      if (
        exactCandidates.length < 1 ||
        exactCandidates.length > 2 ||
        !exactCandidates.includes(subject.subjectRef)
      ) {
        throw new Error(
          "canonical subject requires one or two exact candidates including itself",
        );
      }
      for (const candidate of exactCandidates) {
        assertBoundedUrlIdentity(candidate, "exact URL candidate");
        const owner = candidateOwner.get(candidate);
        if (owner !== undefined && owner !== subject.subjectRef) {
          throw new Error("exact URL candidate belongs to multiple subjects");
        }
        candidateOwner.set(candidate, subject.subjectRef);
      }
      bySubject.set(subject.subjectRef, exactCandidates);
    }

    const orderedSubjects = [...bySubject.keys()].sort();
    await this.lockCanonicalSubjects(scope, siteId, orderedSubjects);
    if (orderedSubjects.length === 0) return new Map();

    const allCandidates = [...candidateOwner.keys()].sort();
    const rowsBySubject = new Map<string, SitePageRow[]>();
    for (const subjectRef of orderedSubjects) rowsBySubject.set(subjectRef, []);
    for (
      let offset = 0;
      offset < allCandidates.length;
      offset += SITE_PAGE_IDENTITY_QUERY_CHUNK
    ) {
      const chunk = allCandidates.slice(
        offset,
        offset + SITE_PAGE_IDENTITY_QUERY_CHUNK,
      );
      const hashes = chunk.map(normalizedUrlHash);
      const rows = (await this.exec
        .select()
        .from(sitePages)
        .where(
          and(
            projectPredicate(sitePages, scope),
            eq(sitePages.site_id, siteId),
            inArray(sitePages.normalized_url_hash, hashes),
            inArray(sitePages.normalized_url, chunk),
          ),
        )
        .orderBy(asc(sitePages.normalized_url), asc(sitePages.id))
        .limit(chunk.length)) as SitePageRow[];
      for (const row of rows) {
        const owner = candidateOwner.get(row.normalized_url);
        if (
          owner === undefined ||
          row.workspace_id !== scope.workspaceId ||
          row.project_id !== scope.projectId ||
          row.site_id !== siteId ||
          row.normalized_url_hash !== normalizedUrlHash(row.normalized_url)
        ) {
          throw new Error(
            "canonical subject lookup returned a foreign durable identity",
          );
        }
        rowsBySubject.get(owner)!.push(row);
      }
    }

    const resolved = new Map<string, SitePageRow | null>();
    for (const subjectRef of orderedSubjects) {
      const rows = rowsBySubject.get(subjectRef)!;
      if (rows.length > 1) {
        resolved.set(subjectRef, null);
      } else if (rows.length === 1) {
        resolved.set(subjectRef, rows[0]!);
      } else {
        resolved.set(
          subjectRef,
          await this.upsertNormalizedUrl({
            workspaceId: scope.workspaceId,
            projectId: scope.projectId,
            siteId,
            normalizedUrl: subjectRef,
            templateKey: null,
          }),
        );
      }
    }
    return resolved;
  }

  async listByProject(
    scope: ProjectScope,
    options: { readonly limit: number; readonly cursor: string | null },
  ): Promise<SitePageListPage> {
    const decoded = options.cursor
      ? decodeTimestampUuidCursor(options.cursor)
      : null;
    if (options.cursor && !decoded) return { rows: [], nextCursor: null };
    const after = decoded
      ? or(
          lt(sitePages.updated_at, decoded.timestamp),
          and(
            eq(sitePages.updated_at, decoded.timestamp),
            lt(sitePages.id, decoded.id),
          ),
        )
      : undefined;
    const rows = (await this.exec
      .select()
      .from(sitePages)
      .where(and(projectPredicate(sitePages, scope), after))
      .orderBy(desc(sitePages.updated_at), desc(sitePages.id))
      .limit(options.limit + 1)) as SitePageRow[];
    const hasNext = rows.length > options.limit;
    const page = hasNext ? rows.slice(0, options.limit) : rows;
    const last = page.at(-1);
    return {
      rows: page,
      nextCursor:
        hasNext && last
          ? encodeTimestampUuidCursor(last.updated_at, last.id)
          : null,
    };
  }
}
