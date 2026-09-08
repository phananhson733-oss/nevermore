import { describe, expect, it } from "vitest";

import {
  COMMERCE_HOSTS,
  FORMAT_RULES,
  FORUM_HOSTS,
  INTENT_RULES,
  ENCYCLOPEDIA_HOSTS,
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
    expect([...VIDEO_HOSTS]).toEqual([
      "youtube.com", "vimeo.com", "tiktok.com", "instagram.com", "bilibili.com", "dailymotion.com",
    ]);
    expect([...FORUM_HOSTS]).toEqual([
      "reddit.com",
      "quora.com",
      "stackexchange.com",
      "stackoverflow.com",
      "zhihu.com",
      "ptt.cc",
      "dcard.tw",
      "v2ex.com",
      "mobile01.com",
    ]);
    expect([...COMMERCE_HOSTS]).toEqual([
      "amazon.com",
      "ebay.com",
      "walmart.com",
      "etsy.com",
      "shopee.com",
      "shopee.tw",
      "taobao.com",
      "tmall.com",
      "jd.com",
      "momoshop.com.tw",
      "pchome.com.tw",
    ]);
    expect([...NEWS_HOSTS]).toEqual([
      "nytimes.com",
      "bbc.com",
      "reuters.com",
      "theguardian.com",
    ]);
    expect([...ENCYCLOPEDIA_HOSTS]).toEqual([
      "wikipedia.org", "wiktionary.org", "baike.baidu.com", "britannica.com", "wikiwand.com",
    ]);
  });

  it("reads a page that names itself a calculator as the tool it is", () => {
    // A live "birth chart" SERP came back seven-tenths unknown while pages
    // titled "Birth Chart Calculator" sat in it: the table read /calculator/ as
    // a directory and never as the end of a slug, and never read the title at
    // all. The observed format distribution is only as good as this table.
    const cases: readonly [string, string, string][] = [
      ["https://x.example/birth-chart", "Birth Chart Calculator | Astrology.com", "tool"],
      ["https://x.example/birth-chart-calculator", "Birth Chart", "tool"],
      ["https://x.example/natal-chart-generator", "Natal Chart Generator", "tool"],
      ["https://x.example/tools/x", "出生星盘计算器", "tool"],
      ["https://x.example/a", "線上排盤產生器", "tool"],
    ];
    for (const [url, title, expected] of cases) {
      expect(classifySerpFormat({ domain: "x.example", url, title }).value, title).toBe(expected);
    }
  });

  it("leaves an article about a calculator an article, and a computer a computer", () => {
    // These decide above the calculator rules on purpose. Reading any of them
    // as a tool page would trade one wrong distribution for another.
    const cases: readonly [string, string, string][] = [
      ["https://x.example/blog/birth-chart-calculator", "Free Birth Chart Calculator", "guide"],
      ["https://x.example/birth-chart", "How to Use a Birth Chart Calculator", "guide"],
      ["https://x.example/birth-chart", "What Is a Birth Chart Calculator?", "guide"],
      ["https://x.example/guide/birth-chart-calculator", "Birth Chart Calculator Guide", "guide"],
      ["https://x.example/best-birth-chart-calculators", "10 Best Birth Chart Calculators", "listicle"],
      // 計算機 is the Traditional Chinese word for a computer, not a calculator.
      ["https://x.example/a", "計算機科學導論", "unknown"],
    ];
    for (const [url, title, expected] of cases) {
      expect(classifySerpFormat({ domain: "x.example", url, title }).value, title).toBe(expected);
    }
  });

  it("classifies the result shapes a Chinese search returns, instead of calling them unknown", () => {
    // Every one of these was "unknown" before: a zh run had six of nine results
    // unclassified, which makes the observed format distribution meaningless.
    const cases: readonly [string, string, string, string][] = [
      ["baike.baidu.com", "https://baike.baidu.com/item/水逆", "水逆", "guide"],
      ["zhihu.com", "https://www.zhihu.com/question/12345", "水逆是什么", "forum"],
      ["shopee.tw", "https://shopee.tw/product/1/2", "水晶", "product_page"],
      ["facebook.com", "https://www.facebook.com/page/videos/12345", "水逆影片", "video"],
      ["example.com", "https://example.com/post", "水逆是什么意思？", "guide"],
      ["example.com", "https://example.com/post", "如何應對水逆", "guide"],
      ["example.com", "https://example.com/post", "Mercury retrograde dates for 2026", "guide"],
      ["example.com", "https://example.com/post", "Mercury retrograde meaning", "guide"],
    ];
    for (const [domain, url, title, expected] of cases) {
      expect(classifySerpFormat({ domain, url, title }).value, title).toBe(expected);
    }
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
      rules_hit: ["host:video", "path:watch"],
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

  it("maps the short-video path patterns to video", () => {
    const cases: readonly (readonly [string, string])[] = [
      ["https://x.example/reels/abc", "path:reels"],
      ["https://x.example/videos/abc", "path:videos"],
    ];
    for (const [url, rule] of cases) {
      expect(classifySerpFormat(serp("x.example", url)), url).toEqual({ value: "video", rules_hit: [rule] });
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

describe("classifySerpFormat: title normalization", () => {
  it("folds a full-width title to its ASCII form before matching", () => {
    // Provider titles arrive as the page wrote them, and a CJK-authored page
    // routinely spells Latin words full-width. Lower-casing alone leaves
    // U+FF57 as U+FF57, so every rule below misses and the row is "unknown".
    expect(classifySerpFormat(serp("x.example", null, "\uff37\uff48\uff41\uff54 \uff49\uff53 \uff41 \uff23\uff32\uff2d"))).toEqual({
      value: "guide", rules_hit: ["title:what_is"],
    });
    expect(classifySerpFormat(serp("x.example", null, "\uff34\uff48\uff45 \uff42\uff45\uff53\uff54 \uff23\uff32\uff2d")).value).toBe("listicle");
  });

  it("maps the remaining explainer and Chinese title patterns to their formats", () => {
    const cases: readonly (readonly [string, SerpFormat, string])[] = [
      ["Mercury retrograde explained", "guide", "title:explained"],
      ["\u6c34\u9006\u65f6\u95f4\u8868", "guide", "title:zh_dates"],
      ["\u6c34\u9006\u6642\u9593\u8868", "guide", "title:zh_dates"],
      ["\u6c34\u9006\u6c34\u6676\u63a8\u8350\u6392\u884c", "listicle", "title:zh_best"],
      ["\u6c34\u9006\u6c34\u6676\u6392\u884c\u699c", "listicle", "title:zh_best"],
    ];
    for (const [title, format, rule] of cases) {
      expect(classifySerpFormat(serp("x.example", null, title)), title).toEqual({ value: format, rules_hit: [rule] });
    }
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
      "host:encyclopedia",
      "path:videos",
      "path:watch",
      "path:reels",
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
      "title:meaning",
      "title:explained",
      "title:dates",
      "title:zh_what_is",
      "title:zh_how_to",
      "title:zh_dates",
      "title:zh_best",
      "title:calculator",
      "title:generator",
      "title:zh_calculator",
      "path:-calculator",
      "path:-generator",
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
