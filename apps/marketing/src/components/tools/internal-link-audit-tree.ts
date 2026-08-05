import type { InternalLinkAuditReport } from "@sf/public-tools";

export interface InternalLinkAuditTreeModel {
  readonly roots: readonly string[];
  readonly childrenById: ReadonlyMap<string, readonly string[]>;
  readonly parentById: ReadonlyMap<string, string>;
  readonly parentRelationById: ReadonlyMap<string, "observed_link">;
  readonly secondaryInboundById: ReadonlyMap<string, number>;
}

/**
 * Render the deterministic predecessor chosen by the server's homepage BFS.
 * URL path shape is not evidence of reachability, and the public edge list is
 * intentionally bounded, so neither is allowed to reconstruct hierarchy here.
 */
export function buildInternalLinkAuditTree(
  report: Pick<InternalLinkAuditReport, "edges" | "nodes">,
): InternalLinkAuditTreeModel {
  const nodeById = new Map(report.nodes.map((node) => [node.id, node]));
  const nodeOrder = new Map(report.nodes.map((node, index) => [node.id, index]));
  const parentById = new Map<string, string>();
  const parentRelationById = new Map<string, "observed_link">();
  for (const node of report.nodes) {
    const parentId = node.primaryParentId;
    if (!parentId || parentId === node.id || !nodeById.has(parentId)) continue;
    parentById.set(node.id, parentId);
    parentRelationById.set(node.id, "observed_link");
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
    report.nodes.map((node) => {
      const parentId = parentById.get(node.id);
      return [
        node.id,
        Math.max(0, node.inboundLinks - (parentId ? 1 : 0)),
      ];
    }),
  );

  return {
    roots,
    childrenById: mutableChildren,
    parentById,
    parentRelationById,
    secondaryInboundById,
  };
}
