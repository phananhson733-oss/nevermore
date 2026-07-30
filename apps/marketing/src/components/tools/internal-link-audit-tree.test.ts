import { describe, expect, it } from "vitest";
import type {
  InternalLinkAuditEdge,
  InternalLinkAuditNode,
} from "@sf/public-tools";
import { buildInternalLinkAuditTree } from "./internal-link-audit-tree.ts";

function node(
  id: string,
  depth: number,
  inboundLinks: number,
  kind: InternalLinkAuditNode["kind"] = "page",
): InternalLinkAuditNode {
  return {
    id,
    url: `https://example.com/${id}`,
    title: id,
    depth,
    inboundLinks,
    outboundLinks: 1,
    statusCode: 200,
    sitemapMember: true,
    kind,
  };
}

function edge(from: string, to: string): InternalLinkAuditEdge {
  return { from, to, anchorText: null };
}

describe("buildInternalLinkAuditTree", () => {
  it("prefers the closest shallower observed parent and keeps cross-links secondary", () => {
    const model = buildInternalLinkAuditTree({
      nodes: [
        node("home", 0, 0, "home"),
        node("guide", 1, 2),
        node("post", 2, 2),
        node("orphan", 1, 0, "orphan_candidate"),
      ],
      edges: [
        edge("home", "guide"),
        edge("home", "post"),
        edge("guide", "post"),
        edge("post", "guide"),
      ],
    });

    expect(model.roots).toEqual(["home", "orphan"]);
    expect(model.parentById.get("guide")).toBe("home");
    expect(model.parentById.get("post")).toBe("guide");
    expect(model.parentById.has("orphan")).toBe(false);
    expect(model.childrenById.get("home")).toEqual(["guide"]);
    expect(model.childrenById.get("guide")).toEqual(["post"]);
    expect(model.secondaryInboundById.get("post")).toBe(1);
  });

  it("keeps same-depth and cyclic relationships out of the display hierarchy", () => {
    const model = buildInternalLinkAuditTree({
      nodes: [node("a", 1, 1), node("b", 1, 1)],
      edges: [edge("a", "b"), edge("b", "a")],
    });

    expect(model.roots).toEqual(["a", "b"]);
    expect(model.parentById.size).toBe(0);
    expect(model.childrenById.get("a")).toEqual([]);
    expect(model.childrenById.get("b")).toEqual([]);
  });
});
