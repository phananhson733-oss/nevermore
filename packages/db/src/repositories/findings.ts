import { and, desc, eq, inArray, lt, notInArray, or, sql } from "drizzle-orm";
import { findings } from "../schema.ts";
import { Repository, projectPredicate, type ProjectScope } from "./base.ts";
import {
  decodeTimestampUuidCursor,
  encodeTimestampUuidCursor,
} from "./cursor.ts";

/**
 * `findings` is the projection of the cross-run finding identity (spec §8.6).
 * `finding_key` is unique per project; a re-hit updates lastSeen + severity/
 * confidence but PRESERVES the human `review_state`/`review_revision`. Only a
 * `completed` (non-partial) run where the rule actually passed may resolve a
 * finding (`active=false`); a re-appearance flips `regressed=true`.
 */

export interface FindingRow {
  readonly id: string;
  readonly workspace_id: string;
  readonly project_id: string;
  readonly finding_key: string;
  readonly rule_id: string;
  readonly rule_version: number;
  readonly rule_family: string;
  readonly intent: string;
  readonly domain: string;
  readonly title_key: string;
  readonly title_args: Record<string, unknown>;
  readonly summary: string;
  readonly summary_locale: string;
  readonly summary_invocation_id?: string | null;
  readonly subject_refs: unknown[];
  readonly severity: string;
  readonly confidence: string;
  readonly review_state: string;
  readonly review_revision: number;
  readonly review_reason: string | null;
  readonly review_note: string | null;
  readonly active: boolean;
  readonly regressed: boolean;
  readonly first_seen_run_id: string;
  readonly last_seen_run_id: string;
  readonly first_seen_at: string;
  readonly last_seen_at: string;
  readonly resolved_at: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface FindingListPage {
  readonly rows: FindingRow[];
  readonly nextCursor: string | null;
}

function encodeCursor(row: { updated_at: string; id: string }): string {
  return encodeTimestampUuidCursor(row.updated_at, row.id);
}
function decodeCursor(
  cursor: string,
): { updatedAt: string; id: string } | null {
  const decoded = decodeTimestampUuidCursor(cursor);
  return decoded
    ? { updatedAt: decoded.timestamp, id: decoded.id }
    : null;
}

export class FindingsRepository extends Repository {
  async findByKey(
    scope: ProjectScope,
    findingKey: string,
  ): Promise<FindingRow | null> {
    const rows = await this.exec
      .select()
      .from(findings)
      .where(
        and(
          projectPredicate(findings, scope),
          eq(findings.finding_key, findingKey),
        ),
      )
      .limit(1);
    return (rows[0] as FindingRow | undefined) ?? null;
  }

  async findById(scope: ProjectScope, id: string): Promise<FindingRow | null> {
    const rows = await this.exec
      .select()
      .from(findings)
      .where(and(projectPredicate(findings, scope), eq(findings.id, id)))
      .limit(1);
    return (rows[0] as FindingRow | undefined) ?? null;
  }

  /** Insert a brand-new finding (first sighting; worker completion tx). */
  async insert(values: {
    workspaceId: string;
    projectId: string;
    findingKey: string;
    ruleId: string;
    ruleVersion: number;
    ruleFamily: string;
    intent: string;
    domain: string;
    titleKey: string;
    titleArgs: Record<string, unknown>;
    summary: string;
    summaryLocale: string;
    summaryInvocationId?: string | null;
    subjectRefs: unknown[];
    severity: string;
    confidence: string;
    reviewState: string;
    runId: string;
    seenAt: string;
  }): Promise<FindingRow> {
    const [row] = await this.exec
      .insert(findings)
      .values({
        workspace_id: values.workspaceId,
        project_id: values.projectId,
        finding_key: values.findingKey,
        rule_id: values.ruleId,
        rule_version: values.ruleVersion,
        rule_family: values.ruleFamily,
        intent: values.intent,
        domain: values.domain,
        title_key: values.titleKey,
        title_args: values.titleArgs,
        summary: values.summary,
        summary_locale: values.summaryLocale,
        summary_invocation_id: values.summaryInvocationId ?? null,
        subject_refs: values.subjectRefs,
        severity: values.severity,
        confidence: values.confidence,
        review_state: values.reviewState,
        first_seen_run_id: values.runId,
        last_seen_run_id: values.runId,
        first_seen_at: values.seenAt,
        last_seen_at: values.seenAt,
      })
      .returning();
    return row as FindingRow;
  }

  /**
   * Re-hit an existing finding: refresh severity/confidence/summary + lastSeen and
   * reactivate, PRESERVING the human review state. `regressed` is set when the
   * finding was previously resolved (spec §8.6).
   */
  async touchSeen(
    id: string,
    values: {
      severity: string;
      confidence: string;
      titleArgs: Record<string, unknown>;
      summary: string;
      summaryLocale: string;
      summaryInvocationId?: string | null;
      subjectRefs: unknown[];
      runId: string;
      seenAt: string;
      regressed: boolean;
    },
  ): Promise<void> {
    await this.exec
      .update(findings)
      .set({
        severity: values.severity,
        confidence: values.confidence,
        title_args: values.titleArgs,
        summary: values.summary,
        summary_locale: values.summaryLocale,
        summary_invocation_id: values.summaryInvocationId ?? null,
        subject_refs: values.subjectRefs,
        last_seen_run_id: values.runId,
        last_seen_at: values.seenAt,
        active: true,
        regressed: values.regressed,
        resolved_at: null,
        updated_at: sql`now()`,
      })
      .where(eq(findings.id, id));
  }

  /** Resolve findings a completed clean run no longer reports (active=false). */
  async resolveByKeysExcept(
    scope: ProjectScope,
    ruleIds: readonly string[],
    keepKeys: readonly string[],
    resolvedAt: string,
  ): Promise<string[]> {
    if (ruleIds.length === 0) return [];
    const notKept =
      keepKeys.length > 0
        ? sql`${findings.finding_key} not in (${sql.join(
            keepKeys.map((k) => sql`${k}`),
            sql`, `,
          )})`
        : sql`true`;
    const rows = (await this.exec
      .update(findings)
      .set({ active: false, resolved_at: resolvedAt, updated_at: sql`now()` })
      .where(
        and(
          projectPredicate(findings, scope),
          inArray(findings.rule_id, [...ruleIds]),
          eq(findings.active, true),
          notKept,
        ),
      )
      .returning({ id: findings.id })) as { id: string }[];
    return rows.map((r) => r.id);
  }

  /**
   * Update the review projection in the review mutation tx (spec §9.1). The
   * update is GUARDED by `expectedRevision` (optimistic concurrency); it returns
   * false when no row matched (a concurrent reviewer already advanced the
   * revision), which the caller maps to 409 VERSION_CONFLICT. The conditional
   * UPDATE also takes the row lock, serializing concurrent reviewers.
   */
  async updateReview(
    scope: ProjectScope,
    id: string,
    values: {
      reviewState: string;
      reviewRevision: number;
      reason: string | null;
      note: string | null;
      expectedRevision: number;
    },
  ): Promise<boolean> {
    const rows = (await this.exec
      .update(findings)
      .set({
        review_state: values.reviewState,
        review_revision: values.reviewRevision,
        review_reason: values.reason,
        review_note: values.note,
        updated_at: sql`now()`,
      })
      .where(
        and(
          projectPredicate(findings, scope),
          eq(findings.id, id),
          eq(findings.review_revision, values.expectedRevision),
        ),
      )
      .returning({ id: findings.id })) as { id: string }[];
    return rows.length > 0;
  }

  /** Keyset page of a project's findings, newest first (spec §11.3). */
  async list(
    scope: ProjectScope,
    opts: {
      limit: number;
      cursor: string | null;
      activeOnly: boolean;
      domain?: string | null;
      reviewState?: string | null;
      excludedReviewStates?: readonly string[];
    },
  ): Promise<FindingListPage> {
    const keyset = opts.cursor ? decodeCursor(opts.cursor) : null;
    if (opts.cursor && !keyset) return { rows: [], nextCursor: null };
    const after =
      keyset != null
        ? or(
            lt(findings.updated_at, keyset.updatedAt),
            and(
              eq(findings.updated_at, keyset.updatedAt),
              lt(findings.id, keyset.id),
            ),
          )
        : undefined;
    const activeFilter = opts.activeOnly
      ? eq(findings.active, true)
      : undefined;
    const domainFilter = opts.domain
      ? eq(findings.domain, opts.domain)
      : undefined;
    const reviewStateFilter = opts.reviewState
      ? eq(findings.review_state, opts.reviewState)
      : undefined;
    const excludedReviewStatesFilter = opts.excludedReviewStates?.length
      ? notInArray(findings.review_state, [...opts.excludedReviewStates])
      : undefined;

    const rows = (await this.exec
      .select()
      .from(findings)
      .where(
        and(
          projectPredicate(findings, scope),
          activeFilter,
          domainFilter,
          reviewStateFilter,
          excludedReviewStatesFilter,
          after,
        ),
      )
      .orderBy(desc(findings.updated_at), desc(findings.id))
      .limit(opts.limit + 1)) as FindingRow[];

    const hasNext = rows.length > opts.limit;
    const page = hasNext ? rows.slice(0, opts.limit) : rows;
    const last = page[page.length - 1];
    return {
      rows: page,
      nextCursor: hasNext && last ? encodeCursor(last) : null,
    };
  }
}
