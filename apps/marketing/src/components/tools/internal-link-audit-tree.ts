import type { InternalLinkAuditReport } from "@sf/public-tools";

export interface InternalLinkAuditTreeModel {
  readonly roots: readonly string[];
  readonly childrenById: ReadonlyMap<string, readonly string[]>;
  readonly parentById: ReadonlyMap<string, string>;
  readonly secondaryInboundById: ReadonlyMap<string, number>;
}

interface ParentCandidate {
  readonly edgeIndex: number;
  readonly parentDepth: number;
  readonly parentId: string;
}

/**
 * Derive one readable display parent per collected page without changing the
 * underlying graph facts. A parent must be shallower than its child, so cycles
 * and same-depth cross-links remain secondary evidence instead of distorting
 * the hierarchy.
 */
export function buildInternalLinkAuditTree(
  report: Pick<InternalLinkAuditReport, "edges" | "nodes">,
): InternalLinkAuditTreeModel {
  const nodeById = new Map(report.nodes.map((node) => [node.id, node]));
  const nodeOrder = new Map(report.nodes.map((node, index) => [node.id, index]));
  const candidatesByTarget = new Map<string, ParentCandidate[]>();

  report.edges.forEach((edge, edgeIndex) => {
    const parent = nodeById.get(edge.from);
    const child = nodeById.get(edge.to);
    if (!parent || !child || parent.id === child.id || parent.depth >= child.depth) {
      return;
    }
    const candidates = candidatesByTarget.get(child.id) ?? [];
    candidates.push({
      edgeIndex,
      parentDepth: parent.depth,
      parentId: parent.id,
    });
    candidatesByTarget.set(child.id, candidates);
  });

  const parentById = new Map<string, string>();
  for (const node of report.nodes) {
    if (node.kind === "home") continue;
    const candidates = candidatesByTarget.get(node.id);
    if (!candidates?.length) continue;
    const [parent] = [...candidates].sort(
      (left, right) =>
        right.parentDepth - left.parentDepth || left.edgeIndex - right.edgeIndex,
    );
    if (parent) parentById.set(node.id, parent.parentId);
  }

  const mutableChildren = new Map<string, string[]>(
    report.nodes.map((node) => [node.id, []]),
  );
  for (const [childId, parentId] of parentById) {
    mutableChildren.get(parentId)?.push(childId);
  }
  const compareNodeOrder = (left: string, right: string) =>
    (nodeOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
    (nodeOrder.get(right) ?? Number.MAX_SAFE_INTEGER);
  for (const children of mutableChildren.values()) {
    children.sort(compareNodeOrder);
  }

  const roots = report.nodes
    .filter((node) => !parentById.has(node.id))
    .map((node) => node.id)
    .sort((left, right) => {
      const leftHome = nodeById.get(left)?.kind === "home";
      const rightHome = nodeById.get(right)?.kind === "home";
      if (leftHome !== rightHome) return leftHome ? -1 : 1;
      return compareNodeOrder(left, right);
    });

  const secondaryInboundById = new Map(
    report.nodes.map((node) => [
      node.id,
      Math.max(0, node.inboundLinks - (parentById.has(node.id) ? 1 : 0)),
    ]),
  );

  return {
    roots,
    childrenById: mutableChildren,
    parentById,
    secondaryInboundById,
  };
}
