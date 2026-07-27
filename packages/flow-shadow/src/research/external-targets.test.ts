import { describe, expect, it } from "vitest";
import { extractContentBriefExternalTargets } from "./external-targets.ts";

describe("extractContentBriefExternalTargets", () => {
  it("extracts, canonicalizes, sorts and de-duplicates markdown and bare URLs", () => {
    const markdown = [
      "## Evidence",
      "Use the [Research report](https://Research.Example:443/report#summary).",
      "Also inspect https://benchmarks.example/index?year=2026.",
      "The same report appears at https://research.example/report.",
    ].join("\n");

    expect(
      extractContentBriefExternalTargets({
        briefMarkdown: markdown,
        firstPartyOrigins: ["https://acme.example"],
      }),
    ).toEqual([
      {
        ref: "content-brief-link:https://benchmarks.example/index?year=2026",
        kind: "content_brief_link",
        url: "https://benchmarks.example/index?year=2026",
        label: "benchmarks.example",
      },
      {
        ref: "content-brief-link:https://research.example/report",
        kind: "content_brief_link",
        url: "https://research.example/report",
        label: "Research report",
      },
    ]);
  });

  it("excludes only explicitly verified first-party hostnames", () => {
    const markdown = [
      "[Home](https://acme.example/)",
      "[Equivalent FQDN](https://acme.example./about)",
      "[Docs](https://docs.acme.example/guide)",
      "[Outside](https://example.net/reference)",
    ].join("\n");

    expect(
      extractContentBriefExternalTargets({
        briefMarkdown: markdown,
        firstPartyOrigins: ["https://acme.example"],
      }).map((target) => target.url),
    ).toEqual([
      "https://docs.acme.example/guide",
      "https://example.net/reference",
    ]);

    expect(
      extractContentBriefExternalTargets({
        briefMarkdown: markdown,
        firstPartyOrigins: [
          "https://acme.example",
          "https://docs.acme.example",
        ],
      }).map((target) => target.url),
    ).toEqual(["https://example.net/reference"]);
  });

  it("uses a deterministic label when the same URL has multiple labels", () => {
    const left = [
      "[Zeta report](https://research.example/report)",
      "[Alpha report](https://research.example/report)",
    ].join("\n");
    const right = left.split("\n").reverse().join("\n");

    expect(
      extractContentBriefExternalTargets({ briefMarkdown: left }),
    ).toEqual(extractContentBriefExternalTargets({ briefMarkdown: right }));
    expect(
      extractContentBriefExternalTargets({ briefMarkdown: left })[0]?.label,
    ).toBe("Alpha report");
  });

  it("ignores non-http links, code fences and URLs beyond the target cap", () => {
    const markdown = [
      "[Mail](mailto:hello@example.com)",
      "```md",
      "https://inside-code.example/secret",
      "```",
      "https://b.example/",
      "https://a.example/",
    ].join("\n");

    expect(
      extractContentBriefExternalTargets({
        briefMarkdown: markdown,
        maxTargets: 1,
      }),
    ).toEqual([
      {
        ref: "content-brief-link:https://a.example/",
        kind: "content_brief_link",
        url: "https://a.example/",
        label: "a.example",
      },
    ]);
  });

  it("keeps the stable ref bounded even when an approved URL is long", () => {
    const longUrl = `https://research.example/${"segment/".repeat(90)}`;
    const [target] = extractContentBriefExternalTargets({
      briefMarkdown: `[Long report](${longUrl})`,
    });

    expect(target?.url).toBe(longUrl);
    expect(target?.ref.length).toBeLessThanOrEqual(500);
    expect(target?.ref).toMatch(/^content-brief-link:hash:/u);
    expect(
      extractContentBriefExternalTargets({
        briefMarkdown: `[Long report](${longUrl})`,
      })[0]?.ref,
    ).toBe(target?.ref);
  });

  it("refuses obvious loopback, private-network and metadata targets", () => {
    const markdown = [
      "http://localhost:8080/admin",
      "http://127.0.0.1/admin",
      "http://10.20.30.40/private",
      "http://169.254.169.254/latest/meta-data/",
      "http://192.168.1.2/private",
      "http://[::1]/admin",
      "http://metadata.google.internal/computeMetadata/v1/",
      "https://research.example/public",
    ].join("\n");

    expect(
      extractContentBriefExternalTargets({ briefMarkdown: markdown }).map(
        (target) => target.url,
      ),
    ).toEqual(["https://research.example/public"]);
  });
});
