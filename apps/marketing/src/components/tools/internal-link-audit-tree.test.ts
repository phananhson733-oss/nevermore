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
  pathname = `/${id}`,
): InternalLinkAuditNode {
  return {
    id,
    url: `https://example.com${pathname}`,
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
    expect(model.parentRelationById.get("guide")).toBe("observed_link");
    expect(model.parentRelationById.get("post")).toBe("observed_link");
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

  it("prefers the nearest collected URL-path ancestor for a clearer site hierarchy", () => {
    const model = buildInternalLinkAuditTree({
      nodes: [
        node("home", 0, 0, "home", "/"),
        node("en", 1, 3, "page", "/en"),
        node("blog", 1, 4, "page", "/en/blog"),
        node("category", 1, 1, "page", "/en/blog/category/case-study"),
      ],
      edges: [
        edge("home", "en"),
        edge("home", "blog"),
        edge("home", "category"),
      ],
    });

    expect(model.roots).toEqual(["home"]);
    expect(model.parentById.get("en")).toBe("home");
    expect(model.parentById.get("blog")).toBe("en");
    expect(model.parentById.get("category")).toBe("blog");
    expect(model.parentRelationById.get("blog")).toBe("url_path");
    expect(model.parentRelationById.get("category")).toBe("url_path");
    expect(model.childrenById.get("home")).toEqual(["en"]);
    expect(model.childrenById.get("en")).toEqual(["blog"]);
    expect(model.childrenById.get("blog")).toEqual(["category"]);
    expect(model.secondaryInboundById.get("blog")).toBe(1);
    expect(model.secondaryInboundById.get("category")).toBe(1);
  });

  it("keeps a sitemap-only orphan outside the URL-path hierarchy", () => {
    const model = buildInternalLinkAuditTree({
      nodes: [
        node("home", 0, 0, "home", "/"),
        node("orphan", 1, 0, "orphan_candidate", "/resources/orphan"),
      ],
      edges: [],
    });

    expect(model.roots).toEqual(["home", "orphan"]);
    expect(model.parentById.has("orphan")).toBe(false);
    expect(model.parentRelationById.has("orphan")).toBe(false);
  });

  it("does not count an observed URL-path parent twice as an additional inbound link", () => {
    const model = buildInternalLinkAuditTree({
      nodes: [
        node("home", 0, 0, "home", "/"),
        node("guide", 1, 1, "page", "/guide"),
        node("article", 2, 2, "page", "/guide/article"),
      ],
      edges: [
        edge("home", "guide"),
        edge("guide", "article"),
        edge("home", "article"),
      ],
    });

    expect(model.parentById.get("article")).toBe("guide");
    expect(model.parentRelationById.get("article")).toBe("url_path");
    expect(model.secondaryInboundById.get("article")).toBe(1);
  });

  it("counts only mapped secondary edges when aggregate inbound totals exceed the edge projection", () => {
    const model = buildInternalLinkAuditTree({
      nodes: [
        node("home", 0, 0, "home", "/"),
        node("guide", 1, 10, "page", "/guide"),
        node("article", 2, 20, "page", "/guide/article"),
      ],
      edges: [
        edge("guide", "article"),
        edge("home", "article"),
      ],
    });

    expect(model.parentById.get("article")).toBe("guide");
    expect(model.secondaryInboundById.get("article")).toBe(1);
  });
});
