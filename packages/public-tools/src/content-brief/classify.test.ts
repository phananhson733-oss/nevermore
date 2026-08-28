import { describe, expect, it } from "vitest";

import {
  COMMERCE_HOSTS,
  FORMAT_RULES,
  FORUM_HOSTS,
  INTENT_RULES,
  NEWS_HOSTS,
  VIDEO_HOSTS,
  classifyIntent,
  classifySerpFormat,
  registrableLabel,
  type IntentRow,
} from "./classify.ts";
import { NAVIGATIONAL_BRAND_MIN_CHARS } from "./constants.ts";
import type { SerpFormat } from "./contract.ts";

function serp(
  domain: string,
  url: string | null = null,
  title: string | null = null,
) {
  return { url, title, domain };
}

function row(
  rank: number,
  format: SerpFormat,
  domain: string,
  title: string | null = null,
  url: string | null = null,
): IntentRow {
  return { rank, format, title, domain, url };
}

describe("host sets", () => {
  it("pin the spec's host lists", () => {
    expect([...VIDEO_HOSTS]).toEqual(["youtube.com", "vimeo.com"]);
    expect([...FORUM_HOSTS]).toEqual([
      "reddit.com",
      "quora.com",
      "stackexchange.com",
      "stackoverflow.com",
    ]);
    expect([...COMMERCE_HOSTS]).toEqual([
      "amazon.com",
      "ebay.com",
      "walmart.com",
      "etsy.com",
    ]);
    expect([...NEWS_HOSTS]).toEqual([
      "nytimes.com",
      "bbc.com",
      "reuters.com",
      "theguardian.com",
    ]);
  });
});

describe("classifySerpFormat: domain rules", () => {
  it("maps each host set to its format", () => {
    expect(classifySerpFormat(serp("youtube.com"))).toEqual({
      value: "video",
      rules_hit: ["host:video"],
    });
    expect(classifySerpFormat(serp("vimeo.com")).value).toBe("video");
    expect(classifySerpFormat(serp("reddit.com"))).toEqual({
      value: "forum",
      rules_hit: ["host:forum"],
    });
    expect(classifySerpFormat(serp("quora.com")).value).toBe("forum");
    expect(classifySerpFormat(serp("stackoverflow.com")).value).toBe("forum");
    expect(classifySerpFormat(serp("amazon.com"))).toEqual({
      value: "product_page",
      rules_hit: ["host:commerce"],
    });
    expect(classifySerpFormat(serp("etsy.com")).value).toBe("product_page");
    expect(classifySerpFormat(serp("bbc.com"))).toEqual({
      value: "news",
      rules_hit: ["host:news"],
    });
    expect(classifySerpFormat(serp("reuters.com")).value).toBe("news");
  });

  it("matches subdomains and ignores a www. prefix and case", () => {
    expect(classifySerpFormat(serp("www.youtube.com")).value).toBe("video");
    expect(classifySerpFormat(serp("m.youtube.com")).value).toBe("video");
    expect(classifySerpFormat(serp("math.stackexchange.com")).value).toBe(
      "forum",
    );
    expect(classifySerpFormat(serp("WWW.Amazon.COM")).value).toBe(
      "product_page",
    );
  });

  it("takes the host from the url when one is given, not from the provider's domain field", () => {
    expect(classifySerpFormat(serp("youtube.com", "https://example.com/blog/x"))).toEqual({
      value: "guide",
      rules_hit: ["path:blog"],
    });
    expect(classifySerpFormat(serp("example.com", "https://www.youtube.com/watch?v=1"))).toEqual({
      value: "video",
      rules_hit: ["host:video"],
    });
    expect(classifySerpFormat(serp("example.com", "https://M.YouTube.com/watch")).value).toBe("video");
  });

  it("falls back to the domain field only when there is no url to trust", () => {
    expect(classifySerpFormat(serp("youtube.com", null)).value).toBe("video");
    expect(classifySerpFormat(serp("youtube.com", "not a url")).value).toBe("unknown");
  });

  it("does not match a host that merely ends with the same letters", () => {
    expect(classifySerpFormat(serp("notyoutube.com")).value).toBe("unknown");
    expect(classifySerpFormat(serp("youtube.com.evil.example")).value).toBe(
      "unknown",
    );
  });
});

describe("classifySerpFormat: path rules", () => {
  it("maps each path pattern to its format", () => {
    const cases: readonly (readonly [string, SerpFormat, string])[] = [
      ["https://x.example/compare/a-b", "comparison", "path:compare"],
      ["https://x.example/vs/a-b", "comparison", "path:vs"],
      ["https://x.example/a-vs-b", "comparison", "path:-vs-"],
      ["https://x.example/tools/roi", "tool", "path:tools"],
      ["https://x.example/calculator", "tool", "path:calculator"],
      ["https://x.example/forum/thread-1", "forum", "path:forum"],
      ["https://x.example/community/q", "forum", "path:community"],
      ["https://x.example/blog/post", "guide", "path:blog"],
      ["https://x.example/guide/crm", "guide", "path:guide"],
      ["https://x.example/learn/crm", "guide", "path:learn"],
      ["https://x.example/product/crm", "product_page", "path:product"],
      ["https://x.example/pricing", "product_page", "path:pricing"],
    ];
    for (const [url, format, rule] of cases) {
      expect(classifySerpFormat(serp("x.example", url)), url).toEqual({
        value: format,
        rules_hit: [rule],
      });
    }
  });

  it("treats a final path segment like a directory so /compare matches /compare/", () => {
    expect(
      classifySerpFormat(serp("x.example", "https://x.example/compare")).value,
    ).toBe("comparison");
    expect(
      classifySerpFormat(serp("x.example", "https://x.example/blog")).value,
    ).toBe("guide");
  });

  it("is case-insensitive on the path and ignores the query string", () => {
    expect(
      classifySerpFormat(
        serp("x.example", "https://x.example/Blog/Post?ref=/pricing"),
      ).value,
    ).toBe("guide");
  });

  it("skips path rules when the url is null or unparsable", () => {
    expect(
      classifySerpFormat(serp("x.example", null, "How to pick a CRM")).value,
    ).toBe("guide");
    expect(
      classifySerpFormat(serp("x.example", "not a url", "How to pick a CRM"))
        .value,
    ).toBe("guide");
    expect(classifySerpFormat(serp("x.example", "not a url", null)).value).toBe(
      "unknown",
    );
  });
});

describe("classifySerpFormat: title rules", () => {
  it("maps each title pattern to its format", () => {
    expect(
      classifySerpFormat(serp("x.example", null, "12 CRM tools for 2026")),
    ).toEqual({
      value: "listicle",
      rules_hit: ["title:leading_number"],
    });
    expect(
      classifySerpFormat(serp("x.example", null, "The best CRM for startups")),
    ).toEqual({
      value: "listicle",
      rules_hit: ["title:best"],
    });
    expect(
      classifySerpFormat(serp("x.example", null, "Our top 7 picks")),
    ).toEqual({
      value: "listicle",
      rules_hit: ["title:top_n"],
    });
    expect(
      classifySerpFormat(serp("x.example", null, "HubSpot vs Salesforce")),
    ).toEqual({
      value: "comparison",
      rules_hit: ["title:vs"],
    });
    expect(
      classifySerpFormat(serp("x.example", null, "How to choose a CRM")),
    ).toEqual({
      value: "guide",
      rules_hit: ["title:how_to"],
    });
    expect(
      classifySerpFormat(serp("x.example", null, "What is a CRM")),
    ).toEqual({
      value: "guide",
      rules_hit: ["title:what_is"],
    });
    expect(
      classifySerpFormat(serp("x.example", null, "The complete CRM guide")),
    ).toEqual({
      value: "guide",
      rules_hit: ["title:guide"],
    });
  });

  it("is case-insensitive on the title", () => {
    expect(classifySerpFormat(serp("x.example", null, "BEST CRM")).value).toBe(
      "listicle",
    );
    expect(
      classifySerpFormat(serp("x.example", null, "HubSpot VS Salesforce"))
        .value,
    ).toBe("comparison");
  });

  it("requires the spaces around vs so 'vs code' does not become a comparison", () => {
    expect(
      classifySerpFormat(serp("x.example", null, "vs code extensions")).value,
    ).toBe("unknown");
  });
});

describe("classifySerpFormat: ordering", () => {
  it("takes the first hit as value and records every later hit in rules_hit", () => {
    expect(
      classifySerpFormat(
        serp(
          "www.youtube.com",
          "https://www.youtube.com/blog/x",
          "Best CRM guide",
        ),
      ),
    ).toEqual({
      value: "video",
      rules_hit: ["host:video", "path:blog", "title:best", "title:guide"],
    });
  });

  it("prefers a path hit over a title hit", () => {
    expect(
      classifySerpFormat(
        serp("x.example", "https://x.example/pricing", "10 reasons to buy"),
      ),
    ).toEqual({
      value: "product_page",
      rules_hit: ["path:pricing", "title:leading_number"],
    });
  });

  it("returns unknown with no rules when nothing matches", () => {
    expect(
      classifySerpFormat(
        serp("x.example", "https://x.example/about", "About us"),
      ),
    ).toEqual({
      value: "unknown",
      rules_hit: [],
    });
  });

  it("publishes the rule table in evaluation order", () => {
    expect(FORMAT_RULES.map((r) => r.id)).toEqual([
      "host:video",
      "host:forum",
      "host:commerce",
      "host:news",
      "path:compare",
      "path:vs",
      "path:-vs-",
      "path:tools",
      "path:calculator",
      "path:forum",
      "path:community",
      "path:blog",
      "path:guide",
      "path:learn",
      "path:product",
      "path:pricing",
      "title:leading_number",
      "title:best",
      "title:top_n",
      "title:vs",
      "title:how_to",
      "title:what_is",
      "title:guide",
    ]);
  });
});

describe("classifyIntent", () => {
  it("maps each format to its intent", () => {
    expect(
      classifyIntent([row(1, "listicle", "a.example")], "crm")?.value,
    ).toBe("commercial");
    expect(
      classifyIntent([row(1, "comparison", "a.example")], "crm")?.value,
    ).toBe("commercial");
    expect(classifyIntent([row(1, "guide", "a.example")], "crm")?.value).toBe(
      "informational",
    );
    expect(classifyIntent([row(1, "forum", "a.example")], "crm")?.value).toBe(
      "informational",
    );
    expect(classifyIntent([row(1, "video", "a.example")], "crm")?.value).toBe(
      "informational",
    );
    expect(
      classifyIntent([row(1, "product_page", "a.example")], "crm")?.value,
    ).toBe("transactional");
    expect(classifyIntent([row(1, "tool", "a.example")], "crm")?.value).toBe(
      "transactional",
    );
  });

  it("treats a domain brand inside the primary keyword as navigational ahead of the format", () => {
    expect(
      classifyIntent(
        [row(1, "listicle", "www.hubspot.com")],
        "hubspot crm pricing",
      ),
    ).toEqual({
      value: "navigational",
      matched: 1,
      tie: false,
      rules_hit: ["intent:navigational", "intent:commercial_listicle"],
    });
    expect(
      classifyIntent(
        [row(1, "guide", "blog.hubspot.com")],
        "hub spot alternatives",
      )?.value,
    ).toBe("navigational");
  });

  it("does not call a brand navigational when the keyword only shares a short fragment", () => {
    expect(
      classifyIntent([row(1, "guide", "hp.com")], "php tutorial")?.value,
    ).toBe("informational");
    expect(
      classifyIntent([row(1, "guide", "example.co.uk")], "crm example")?.value,
    ).toBe("navigational");
  });

  it("matches the brand only on keyword token boundaries, never as an arbitrary substring", () => {
    expect(classifyIntent([row(1, "guide", "art.com")], "cart software")?.value).toBe("informational");
    expect(classifyIntent([row(1, "guide", "art.com")], "smart art software")?.value).toBe("navigational");
    expect(classifyIntent([row(1, "guide", "hubspot.com")], "myhubspot login")?.value).toBe("informational");
    expect(classifyIntent([row(1, "guide", "hubspot.com")], "hubspot-crm pricing")?.value).toBe("navigational");
  });

  it("accepts a brand spelled as adjacent keyword tokens but not with a token in between", () => {
    expect(classifyIntent([row(1, "guide", "hubspot.com")], "hub spot alternatives")?.value).toBe("navigational");
    expect(classifyIntent([row(1, "guide", "hubspot.com")], "hub crm spot")?.value).toBe("informational");
    expect(classifyIntent([row(1, "guide", "hubspot.com")], "best hub spot")?.value).toBe("navigational");
  });

  it("takes the navigational brand from the url host, never from the domain field when a url exists", () => {
    expect(classifyIntent([row(1, "guide", "hubspot.com", null, "https://example.com/guide")], "hubspot login")).toEqual({
      value: "informational",
      matched: 1,
      tie: false,
      rules_hit: ["intent:informational_guide"],
    });
    expect(classifyIntent([row(1, "guide", "example.com", null, "https://www.hubspot.com/x")], "hubspot login")?.value).toBe(
      "navigational",
    );
    expect(classifyIntent([row(1, "guide", "hubspot.com", null, "not a url")], "hubspot login")?.value).toBe(
      "informational",
    );
    expect(classifyIntent([row(1, "guide", "hubspot.com", null, null)], "hubspot login")?.value).toBe("navigational");
  });

  it("reads the brand length floor from constants", () => {
    const brand = "b".repeat(NAVIGATIONAL_BRAND_MIN_CHARS);
    const short = "b".repeat(NAVIGATIONAL_BRAND_MIN_CHARS - 1);
    expect(classifyIntent([row(1, "guide", `${brand}.com`)], `${brand} pricing`)?.value).toBe("navigational");
    expect(classifyIntent([row(1, "guide", `${short}.com`)], `${short} pricing`)?.value).toBe("informational");
  });

  it("returns the majority intent with its matched count", () => {
    const out = classifyIntent(
      [
        row(1, "guide", "a.example"),
        row(2, "listicle", "b.example"),
        row(3, "guide", "c.example"),
        row(4, "unknown", "d.example"),
        row(5, "video", "e.example"),
      ],
      "crm",
    );
    expect(out).toEqual({
      value: "informational",
      matched: 3,
      tie: false,
      rules_hit: [
        "intent:informational_guide",
        "intent:commercial_listicle",
        "intent:informational_video",
      ],
    });
  });

  it("breaks a three-way tie with the best-ranked row and flags it", () => {
    const out = classifyIntent(
      [
        row(3, "guide", "a.example"),
        row(1, "listicle", "b.example"),
        row(2, "product_page", "c.example"),
      ],
      "crm",
    );
    expect(out).toEqual({
      value: "commercial",
      matched: 1,
      tie: true,
      rules_hit: [
        "intent:commercial_listicle",
        "intent:transactional_product_page",
        "intent:informational_guide",
      ],
    });
  });

  it("breaks a tie with the best-ranked row among the leaders, not the best-ranked row overall", () => {
    const out = classifyIntent(
      [
        row(1, "listicle", "a.example"),
        row(2, "guide", "b.example"),
        row(3, "video", "c.example"),
        row(4, "product_page", "d.example"),
        row(5, "tool", "e.example"),
      ],
      "crm",
    );
    expect(out?.value).toBe("informational");
    expect(out?.matched).toBe(2);
    expect(out?.tie).toBe(true);
  });

  it("does not flag a tie between non-leading intents", () => {
    const out = classifyIntent(
      [
        row(1, "guide", "a.example"),
        row(2, "guide", "b.example"),
        row(3, "listicle", "c.example"),
        row(4, "tool", "d.example"),
      ],
      "crm",
    );
    expect(out?.value).toBe("informational");
    expect(out?.tie).toBe(false);
  });

  it("ignores input order when resolving a tie", () => {
    const rows = [
      row(2, "guide", "a.example"),
      row(1, "listicle", "b.example"),
    ];
    expect(classifyIntent(rows, "crm")?.value).toBe("commercial");
    expect(classifyIntent([...rows].reverse(), "crm")?.value).toBe(
      "commercial",
    );
  });

  it("returns null when no row hits any intent rule", () => {
    expect(
      classifyIntent(
        [row(1, "unknown", "a.example"), row(2, "news", "b.example")],
        "crm",
      ),
    ).toBeNull();
    expect(classifyIntent([], "crm")).toBeNull();
  });

  it("publishes the intent rule table in evaluation order", () => {
    expect(INTENT_RULES.map((r) => r.id)).toEqual([
      "intent:navigational",
      "intent:commercial_listicle",
      "intent:commercial_comparison",
      "intent:informational_guide",
      "intent:informational_forum",
      "intent:informational_video",
      "intent:transactional_product_page",
      "intent:transactional_tool",
    ]);
  });
});

describe("registrableLabel", () => {
  it("returns the label before the public suffix", () => {
    expect(registrableLabel("acme.com")).toBe("acme");
    expect(registrableLabel("blog.acme.com")).toBe("acme");
    expect(registrableLabel("blog.acme.co.uk")).toBe("acme");
    expect(registrableLabel("acme.com.au")).toBe("acme");
  });

  it("normalises case, a trailing dot and a www. prefix", () => {
    expect(registrableLabel("WWW.Acme.COM.")).toBe("acme");
  });

  it("applies no length floor itself; the caller decides", () => {
    expect(registrableLabel("hp.com")).toBe("hp");
    expect(registrableLabel("a.example")).toBe("a");
  });

  it("returns null when there is no registrable label", () => {
    expect(registrableLabel("localhost")).toBeNull();
    expect(registrableLabel("")).toBeNull();
  });
});
