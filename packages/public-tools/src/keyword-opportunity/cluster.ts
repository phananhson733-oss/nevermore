// @input  -- the keywords that survived validation
// @output -- lexical groups, labelled as suggestions
// @pos    -- grouping only; proving two terms share a page needs page-one overlap we do not fetch
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { keywordTokens } from "./coverage.ts";
import type { KeywordOpportunityCluster } from "./types.ts";

/** Token overlap at which two terms are grouped. */
export const KEYWORD_CLUSTER_JACCARD = 0.5;

const STOP_TOKENS = new Set([
  "a",
  "an",
  "the",
  "for",
  "to",
  "of",
  "in",
  "on",
  "with",
  "and",
  "or",
  "how",
  "what",
  "why",
  "is",
  "are",
  "do",
  "does",
  "can",
  "my",
  "your",
  "best",
  "free",
  "online",
]);

function contentTokens(keyword: string): Set<string> {
  const tokens = keywordTokens(keyword);
  const kept = new Set<string>();
  for (const token of tokens) {
    if (!STOP_TOKENS.has(token)) kept.add(token);
  }
  return kept.size > 0 ? kept : tokens;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) {
    if (b.has(token)) shared += 1;
  }
  return shared / (a.size + b.size - shared);
}

/**
 * Group keywords by shared content tokens.
 *
 * Single-link agglomeration against the first matching group, which is enough
 * for the fifty-odd terms a run shows and keeps the result stable: the same
 * input list always produces the same grouping, so two runs of the same site
 * are comparable.
 *
 * Stop words are dropped before comparing. Leaving them in makes every
 * question-form phrasing look related to every other one, since "how to" is
 * two of five tokens in most of them.
 *
 * The label is the shortest member, which reads as the head of the group far
 * more often than the first or the highest-volume one does.
 */
export function clusterKeywords(
  keywords: readonly string[],
): readonly KeywordOpportunityCluster[] {
  // The member list is typed non-empty because a group is only ever created
  // around its first keyword. That makes the label lookup total: no index
  // guard, and so no branch that no input can reach.
  const groups: { tokens: Set<string>; members: [string, ...string[]] }[] = [];

  // Deduplicated first. A group's token set grows on every join, so the same
  // term arriving twice can match a different group the second time and the
  // reverse index would then point one of its rows at a group it does not
  // belong to.
  for (const keyword of new Set(keywords)) {
    const tokens = contentTokens(keyword);
    const match = groups.find(
      (group) => jaccard(group.tokens, tokens) >= KEYWORD_CLUSTER_JACCARD,
    );
    if (match === undefined) {
      groups.push({ tokens, members: [keyword] });
      continue;
    }
    match.members.push(keyword);
    for (const token of tokens) match.tokens.add(token);
  }

  return groups.map((group, index) => ({
    id: `cluster-${index + 1}`,
    label: group.members.reduce((shortest, member) =>
      member.length < shortest.length ||
      (member.length === shortest.length && member < shortest)
        ? member
        : shortest,
    ),
    keywords: group.members,
  }));
}

/** Reverse index so each row can carry the group it landed in. */
export function keywordClusterIndex(
  clusters: readonly KeywordOpportunityCluster[],
): ReadonlyMap<string, string> {
  const index = new Map<string, string>();
  for (const cluster of clusters) {
    for (const keyword of cluster.keywords) index.set(keyword, cluster.id);
  }
  return index;
}
