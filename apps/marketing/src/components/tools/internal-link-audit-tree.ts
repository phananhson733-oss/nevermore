import type { InternalLinkAuditReport } from "@sf/public-tools";

export interface InternalLinkAuditTreeModel {
  readonly roots: readonly string[];
  readonly childrenById: ReadonlyMap<string, readonly string[]>;
  readonly parentById: ReadonlyMap<string, string>;
  readonly parentRelationById: ReadonlyMap<
    string,
    "observed_link" | "url_path"
  >;
  readonly secondaryInboundById: ReadonlyMap<string, number>;
}

interface ParentCandidate {
  readonly edgeIndex: number;
  readonly parentDepth: number;
  readonly parentId: string;
}

interface ParsedPageLocation {
  readonly origin: string;
  readonly pathname: string;
}

function pageLocation(url: string): ParsedPageLocation | null {
  try {
    const parsed = new URL(url);
    const pathname =
      parsed.pathname === "/"
        ? "/"
        : parsed.pathname.replace(/\/+$/, "") || "/";
    return { origin: parsed.origin, pathname };
  } catch {
    return null;
  }
}

function isStrictPathAncestor(
  parent: ParsedPageLocation,
  child: ParsedPageLocation,
): boolean {
  if (parent.origin !== child.origin || parent.pathname === child.pathname) {
    return false;
  }
  if (parent.pathname === "/") return true;
  return child.pathname.startsWith(`${parent.pathname}/`);
}

/**
 * Derive one readable display parent per collected page without changing the
 * underlying graph facts. URL-path ancestry is preferred because it produces a
 * stable, scannable site hierarchy even when sitemap seeds share one crawl
 * depth. When no collected path ancestor exists, a parent must be shallower
 * than its child, so cycles and same-depth cross-links remain secondary
 * evidence instead of distorting the hierarchy.
 */
export function buildInternalLinkAuditTree(
  report: Pick<InternalLinkAuditReport, "edges" | "nodes">,
): InternalLinkAuditTreeModel {
  const nodeById = new Map(report.nodes.map((node) => [node.id, node]));
  const nodeOrder = new Map(report.nodes.map((node, index) => [node.id, index]));
  const locationById = new Map(
    report.nodes.map((node) => [node.id, pageLocation(node.url)]),
  );
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
  const parentRelationById = new Map<
    string,
    "observed_link" | "url_path"
  >();
  for (const node of report.nodes) {
    if (node.kind === "home") continue;
    const nodeLocation = locationById.get(node.id);
    const pathParent = nodeLocation && node.inboundLinks > 0
      ? report.nodes
          .filter((candidate) => candidate.id !== node.id)
          .filter((candidate) => {
            const candidateLocation = locationById.get(candidate.id);
            return (
              candidateLocation !== null &&
              candidateLocation !== undefined &&
              isStrictPathAncestor(candidateLocation, nodeLocation)
            );
          })
          .sort((left, right) => {
            const leftPathLength =
              locationById.get(left.id)?.pathname.length ?? 0;
            const rightPathLength =
              locationById.get(right.id)?.pathname.length ?? 0;
            return (
              rightPathLength - leftPathLength ||
              (nodeOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
                (nodeOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER)
            );
          })[0]
      : undefined;
    if (pathParent) {
      parentById.set(node.id, pathParent.id);
      parentRelationById.set(node.id, "url_path");
      continue;
    }

    const candidates = candidatesByTarget.get(node.id);
    if (!candidates?.length) continue;
    const [parent] = [...candidates].sort(
      (left, right) =>
        right.parentDepth - left.parentDepth || left.edgeIndex - right.edgeIndex,
    );
    if (parent) {
      parentById.set(node.id, parent.parentId);
      parentRelationById.set(node.id, "observed_link");
    }
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
        report.edges.filter(
          (edge) => edge.to === node.id && edge.from !== parentId,
        ).length,
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
