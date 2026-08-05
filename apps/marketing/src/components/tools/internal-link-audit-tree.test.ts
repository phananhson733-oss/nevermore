import { describe, expect, it } from "vitest";
import type {
  InternalLinkAuditEdge,
  InternalLinkAuditNode,
} from "@sf/public-tools";
import { buildInternalLinkAuditTree } from "./internal-link-audit-tree.ts";

function node(
  id: string,
  clickDepth: number | null,
  inboundLinks: number,
  primaryParentId: string | null,
  kind: InternalLinkAuditNode["kind"] = "page",
): InternalLinkAuditNode {
  return {
    id,
    url: `https://example.com/${id}`,
    title: id,
    crawlDepth: clickDepth ?? 1,
    clickDepth,
    primaryParentId,
    inboundLinks,
    outboundLinks: 1,
    statusCode: 200,
    sitemapMember: true,
    robotsIndexable: true,
    canonicalTarget: null,
    kind,
  };
}

function edge(from: string, to: string): InternalLinkAuditEdge {
  return { from, to, anchorText: null };
}

describe("buildInternalLinkAuditTree", () => {
  it("uses the server-selected shortest-path predecessor", () => {
    const model = buildInternalLinkAuditTree({
      nodes: [
        node("home", 0, 0, null, "home"),
        node("guide", 1, 2, "home"),
        node("post", 2, 3, "guide"),
      ],
      edges: [
        edge("home", "guide"),
        edge("home", "post"),
        edge("guide", "post"),
      ],
    });

    expect(model.roots).toEqual(["home"]);
    expect(model.parentById.get("guide")).toBe("home");
    expect(model.parentById.get("post")).toBe("guide");
    expect(model.childrenById.get("home")).toEqual(["guide"]);
    expect(model.childrenById.get("guide")).toEqual(["post"]);
    expect(model.secondaryInboundById.get("post")).toBe(2);
  });

  it("keeps unreachable pages outside the homepage hierarchy", () => {
    const model = buildInternalLinkAuditTree({
      nodes: [
        node("home", 0, 0, null, "home"),
        node("orphan", null, 0, null, "orphan_candidate"),
        node("unreachable", null, 2, null, "unreachable"),
      ],
      edges: [edge("orphan", "unreachable")],
    });

    expect(model.roots).toEqual(["home", "orphan", "unreachable"]);
    expect(model.parentById.size).toBe(0);
  });

  it("does not reconstruct hierarchy from a truncated display edge list", () => {
    const model = buildInternalLinkAuditTree({
      nodes: [
        node("home", 0, 0, null, "home"),
        node("guide", 1, 10, "home"),
        node("article", 2, 20, "guide"),
      ],
      edges: [],
    });

    expect(model.parentById.get("article")).toBe("guide");
    expect(model.secondaryInboundById.get("article")).toBe(19);
  });

  it("ignores an invalid predecessor instead of manufacturing a path", () => {
    const model = buildInternalLinkAuditTree({
      nodes: [node("page", null, 1, "missing", "unreachable")],
      edges: [],
    });

    expect(model.roots).toEqual(["page"]);
    expect(model.parentById.size).toBe(0);
  });
});
