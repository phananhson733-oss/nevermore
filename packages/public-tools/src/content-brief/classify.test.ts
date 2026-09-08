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
  it("pins every host list, so a site is added or removed on purpose", () => {
    // Not a copy of an external list: these are the sites the table has been
    // given, and the assertion exists so that adding one is a decision someone
    // made rather than a side effect. A suffix entry covers every subdomain,
    // which is why MacRumors appears only as its forum.
    expect([...VIDEO_HOSTS]).toEqual([
      "youtube.com", "vimeo.com", "tiktok.com", "instagram.com", "bilibili.com", "dailymotion.com",
    ]);
    expect([...FORUM_HOSTS]).toEqual([
      "reddit.com", "quora.com", "stackexchange.com", "superuser.com", "serverfault.com", "askubuntu.com",
      "stackoverflow.com", "forums.macrumors.com", "xda-developers.com",
      "zhihu.com", "ptt.cc", "dcard.tw", "v2ex.com", "mobile01.com",
    ]);
    expect([...COMMERCE_HOSTS]).toEqual([
      "amazon.com", "ebay.com", "walmart.com", "etsy.com", "bestbuy.com", "homedepot.com",
      "shopee.com", "shopee.tw", "taobao.com", "tmall.com", "jd.com", "momoshop.com.tw", "pchome.com.tw",
      "apps.microsoft.com", "apps.apple.com", "play.google.com",
    ]);
    expect([...NEWS_HOSTS]).toEqual(["nytimes.com", "bbc.com", "reuters.com", "theguardian.com"]);
    expect([...ENCYCLOPEDIA_HOSTS]).toEqual([
      "wikipedia.org", "wiktionary.org", "baike.baidu.com", "britannica.com", "wikiwand.com", "medlineplus.gov",
    ]);
  });

  it("reads a page that names itself a calculator as the tool it is", () => {
    // A live "birth chart" SERP came back seven tenths unknown while pages
    // titled "Birth Chart Calculator" sat in it: the table read /calculator/ as
    // a directory and never as the end of a slug, and never read the title at
    // all. The observed format distribution is only as good as this table.
    //
    // Each case can only be decided by the one rule it is here for: a title
    // case carries a path nothing matches, a slug case carries a title nothing
    // matches. A table where the title and the slug cover for each other stays
    // green when either is deleted.
    const cases: readonly [string, string, string][] = [
      ["https://x.example/birth-chart", "Birth Chart Calculator | Astrology.com", "tool"],
      ["https://x.example/birth-chart-calculator", "Untitled", "tool"],
      ["https://x.example/natal-chart-generator", "Chart Maker", "tool"],
      ["https://x.example/a", "出生星盘计算器", "tool"],
      ["https://x.example/a", "線上排盤產生器", "tool"],
      // A four-digit leading number that is a year is not a count.
      ["https://x.example/a", "2026 General Schedule (GS) Salary Calculator", "tool"],
      // "dates" names what the page is about; "calculator" names what it is.
      // timeanddate.com read its own duration calculator as a guide and the
      // FAQ about that calculator as a tool, exactly inverted.
      ["https://www.timeanddate.com/date/timeduration.html", "Time Duration Calculator - Count days between dates", "tool"],
      ["https://www.mdcalc.com/calc/423/pregnancy-due-dates", "Pregnancy Due Dates Calculator", "tool"],
      ["https://plaincalculators.com/angel-number-calculator/", "Angel Number Calculator - Meaning of Repeating Numbers", "tool"],
      // What it compares is the calculator's subject. Left above, the whole
      // rent-vs-buy family read as editorial comparisons and a SERP of nothing
      // but calculators reported commercial intent instead of a tool one.
      ["https://www.calculator.net/rent-vs-buy-calculator.html", "Rent vs. Buy Calculator", "tool"],
      ["https://www.schwab.com/ira/ira-calculators/roth-vs-traditional", "Roth vs. Traditional IRA Calculator | Charles Schwab", "tool"],
      // A title names the page and then says something about it, so a question
      // after the calculator's name is its subtitle, not its kind.
      ["https://astrochart.io/moon-sign", "Free Moon Sign Calculator - What Is My Moon Sign? | AstroChart", "tool"],
      ["https://astrofox.tw/rising-sign", "上升星座查詢計算器 | 上升星座是什麼？怎麼看？ | 占星狐狸", "tool"],
      ["https://x.example/a", "Mortgage Calculator: How to Read Your Results", "tool"],
    ];
    for (const [url, title, expected] of cases) {
      expect(classifySerpFormat({ domain: "x.example", url, title }).value, title).toBe(expected);
    }
  });

  it("leaves an article about a calculator an article, and a machine a machine", () => {
    // Everything that marks an article about a calculator decides above the
    // calculator rules, and so does every path that names an article or a
    // product. Reading any of these as a tool page would trade one wrong
    // distribution for another.
    const cases: readonly [string, string, string, string][] = [
      ["x.example", "https://x.example/blog/birth-chart-calculator", "Free Birth Chart Calculator", "guide"],
      // The article paths decide below the round-up titles now, so a blog's own
      // round-up is a list. A blog post that makes no list of itself still
      // reaches them, which is what keeps the row above a guide.
      ["zapier.com", "https://zapier.com/blog/best-project-management-software/", "The 8 best project management software in 2026", "listicle"],
      ["apptunix.com", "https://www.apptunix.com/blog/top-5-best-astrology-apps/", "Top 10 Best Astrology Apps in 2026 You Can Trust", "listicle"],
      // A number followed by a unit of time measures something; it does not
      // count items. Both of these read as lists before.
      ["whattoexpect.com", "https://www.whattoexpect.com/pregnancy/week-by-week/week-12.aspx", "12 Weeks Pregnant: Symptoms, Baby Development & More", "unknown"],
      ["10minutemail.com", "https://10minutemail.com/", "10 Minute Mail - Free Anonymous Temporary Email", "unknown"],
      // The unit has to be the whole word, or a city that starts with one
      // stops the count: "Dayton" is not a day.
      ["x.example", "https://x.example/a", "10 Dayton Restaurants to Try", "listicle"],
      ["x.example", "https://x.example/guide/birth-chart-calculator", "Birth Chart Calculator Guide", "guide"],
      ["x.example", "https://x.example/birth-chart", "How to Use a Birth Chart Calculator", "guide"],
      ["x.example", "https://x.example/birth-chart", "What Is a Birth Chart Calculator?", "guide"],
      ["x.example", "https://x.example/mortgage-calculator", "Mortgage calculator explained", "guide"],
      ["timeanddate.com", "https://www.timeanddate.com/date/timeduration-help.html", "FAQ: Time Duration Calculator", "guide"],
      // "meaning" moved below the calculator rules with "dates", and for the
      // same reason. A page about a subject keeps that word; a page that is a
      // calculator keeps it too, and only one of them is a calculator.
      ["x.example", "https://x.example/a", "Angel Number 444 Meaning", "guide"],
      // The question rules keep every title that asks before it names.
      ["x.example", "https://x.example/a", "What Is a Birth Chart Calculator?", "guide"],
      ["rates.ca", "https://rates.ca/resources/how-to-use-a-mortgage-calculator", "How to Use a Mortgage Calculator", "guide"],
      ["x.example", "https://x.example/a", "如何使用星盤計算器", "guide"],
      // 教程 and 攻略 name a kind of writing, so they hold wherever they sit:
      // this is why the Chinese question rule could not simply be reordered.
      ["labex.io", "https://labex.io/zh/tutorials/python-create-a-gui-calculator-with-python-298861", "使用 Python 创建基本图形用户界面计算器 | Tkinter 教程", "guide"],
      // A comparison with no calculator in it is still a comparison.
      ["x.example", "https://x.example/rent-vs-buy", "Rent vs Buy: Which Is Better in 2026?", "comparison"],
      ["x.example", "https://x.example/iphone-vs-android/", "Our Verdict", "comparison"],
      // A how-to that mentions the best of something is not a round-up.
      ["x.example", "https://x.example/a", "How to get the best mortgage rate", "guide"],
      // Past a hundred a leading number is nearly always an identifier. US
      // finance is full of them and every one read as a list of hundreds.
      ["investopedia.com", "https://www.investopedia.com/terms/1/529plan.asp", "529 Plan: What It Is, How It Works, Pros and Cons", "unknown"],
      ["investopedia.com", "https://www.investopedia.com/terms/1/1031exchange.asp", "1031 Exchange Rules: What You Need to Know", "unknown"],
      // Moving "dates" below the calculator rules costs nothing here: a page
      // about dates that never claims to be a calculator is still a guide.
      ["irs.gov", "https://www.irs.gov/filing/important-tax-dates", "Important Tax Filing Dates 2026", "guide"],
      ["x.example", "https://x.example/a", "使用 Python 创建计算器 | Tkinter 教程", "guide"],
      // A slug is not a path rule: an article's own URL keeps the calculator's
      // name, so the suffix decides after every title rule, not before them.
      ["rates.ca", "https://rates.ca/resources/how-to-use-a-mortgage-calculator", "How to Use a Mortgage Calculator", "guide"],
      ["x.example", "https://x.example/product/scientific-calculator", "Scientific Calculator", "product_page"],
      ["x.example", "https://x.example/pricing/report-generator", "Report Generator", "product_page"],
      // No "best" here: a broken count rule drops this row to title:calculator
      // and the format changes. With "best" in it the row is listicle either
      // way and pins nothing.
      ["x.example", "https://x.example/a", "10 Mortgage Calculator Sites", "listicle"],
      // Four digits are a year, a tax form or a count and the title does not
      // say which. "1040 Tax Calculator" is the case that decided it: reading
      // the number as a length made it a list of a thousand items.
      ["dinkytown.net", "https://www.dinkytown.net/java/1040-tax-calculator.html", "1040 Tax Calculator", "tool"],
      // No "best" in it, so the hundred itself is what makes this a list: the
      // bound is inclusive, and dropping the hundred drops this row to unknown.
      ["x.example", "https://x.example/a", "100 Questions to ask your partner", "listicle"],
      // An app marketplace listing for a calculator is a product page.
      ["apps.microsoft.com", "https://apps.microsoft.com/detail/9wzdncrfhvn5", "Windows Calculator", "product_page"],
      // A generator is as often a machine as a program and no lexical test
      // separates them, so there is no English rule: this catalogue stays
      // unclassified, and so does RANDOM.ORG's "Sequence Generator".
      ["engines.honda.com", "https://engines.honda.com/models/application/generator", "Generator Engines", "unknown"],
      ["random.org", "https://www.random.org/sequences/", "RANDOM.ORG - Sequence Generator", "unknown"],
      // -calculator has to end a segment, or a review of one becomes one.
      ["x.example", "https://x.example/mortgage-calculator-review", "Our Verdict", "unknown"],
      // The bound the count rule really has: a leading number of four digits
      // or more is not read as a count at all, so a page whose title says
      // nothing else is reported as unclassified rather than as a list.
      ["x.example", "https://x.example/a", "1000 Questions to ask people", "unknown"],
      // 計算機 is a calculator in Traditional Chinese and also a computer, so
      // it is left out: this under-matches rather than reading a computer
      // science text as a tool.
      ["x.example", "https://x.example/a", "計算機科學導論", "unknown"],
      ["bmi.tw", "https://bmi.tw/", "BMI計算機", "unknown"],
      // A store sells physical calculators and generators, and neither the
      // slug nor the Chinese title can tell those from software. The commerce
      // path is what does. Both of these are live pages that read as tools.
      ["duromaxpower.com", "https://www.duromaxpower.com/products/duromax-xp13000eh-13000-watt-portable-hybrid-gas-propane-generator", "13,000 Watt Dual Fuel Portable Generator", "product_page"],
      ["keysight.com", "https://www.keysight.com/tw/zh/products/waveform-and-function-generators.bac.html", "波形和函數產生器 | Keysight", "product_page"],
      // Accepted, and the same behaviour /product/ singular already had: a
      // round-up that lives under /products/ reads as a product page.
      ["x.example", "https://x.example/products/mortgage-picks", "Best Mortgage Tools", "product_page"],
    ];
    for (const [domain, url, title, expected] of cases) {
      expect(classifySerpFormat({ domain, url, title }).value, title).toBe(expected);
    }
    // One exception, known and left alone: path:calculator decides above every
    // title rule, so a round-up that lives under one still reads as a tool.
    // Its needle is "/calculator" with no closing slash, so it is a segment
    // that STARTS with the word, not a directory named it -- /calculator-review
    // matches and /mortgage-calculator does not. That rule predates these ones
    // and reordering it would change classifications this change is not about.
    expect(classifySerpFormat({ domain: "x.example", url: "https://x.example/mortgage/calculator/", title: "The Best Mortgage Calculators of 2026" }).value).toBe("tool");
    expect(classifySerpFormat({ domain: "x.example", url: "https://x.example/calculator-review", title: "Our Verdict" }).value).toBe("tool");
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
      rules_hit: ["host:video", "title:best", "path:blog", "title:guide"],
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
      "host:encyclopedia",
      "path:videos",
      "path:reels",
      "path:compare",
      "path:vs",
      "path:tools",
      "path:calculator",
      "path:forum",
      "path:community",
      "path:product",
      "path:products",
      "path:pricing",
      "title:leading_number",
      "title:how_to",
      "title:best",
      "title:top_n",
      "path:blog",
      "path:guide",
      "path:learn",
      "title:what_is",
      "title:guide",
      "title:explained",
      "title:faq",
      "title:zh_what_is",
      "title:zh_tutorial",
      "title:zh_how_to",
      "title:zh_dates",
      "title:zh_best",
      "title:calculator",
      "title:zh_calculator",
      "title:dates",
      "title:meaning",
      "title:vs",
      "path:-vs-",
      "path:-calculator",
      "path:-generator",
      "host:news",
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

describe("classifySerpFormat: host sets", () => {
  it("reaches the sites a suffix set does not, and stops at the ones it should not", () => {
    // A sweep over real search results found each of these rows unclassified
    // or classified as the wrong thing. Every one is decided by a host set, so
    // each case is a claim about the set and nothing else.
    const cases: readonly [string, string, string, string][] = [
      // Stack Exchange's siblings are their own registrable domains, so the
      // stackexchange.com suffix never reached them.
      ["superuser.com", "https://superuser.com/questions/tagged/regex", "Newest 'regex' Questions - Super User", "forum"],
      ["forum.xda-developers.com", "https://forum.xda-developers.com/", "XDA Forums", "forum"],
      // Only the forum subdomain of MacRumors, which also publishes news: a
      // suffix entry would turn its reporting into forum threads.
      ["forums.macrumors.com", "https://forums.macrumors.com/forums/", "Forums | MacRumors Forums", "forum"],
      ["www.macrumors.com", "https://www.macrumors.com/2026/09/08/apple-event/", "Apple Announces September Event", "unknown"],
      ["medlineplus.gov", "https://medlineplus.gov/ency/article/007196.htm", "Body mass index (BMI): MedlinePlus Medical Encyclopedia", "guide"],
      ["www.bestbuy.com", "https://www.bestbuy.com/", "Best Buy | Official Online Store | Shop Now & Save", "product_page"],
      ["www.homedepot.com", "https://www.homedepot.com/b/Tools/N-5yc1vZc1xy", "Tools - The Home Depot", "product_page"],
      // The commerce set matches by suffix, so a shop's documentation was a
      // shop. The exception is checked against that set alone.
      ["aws.amazon.com", "https://aws.amazon.com/cn/what-is/api/", "什么是 API？ - API 详解 - AWS", "guide"],
      ["docs.aws.amazon.com", "https://docs.aws.amazon.com/lambda/latest/dg/welcome.html", "What is AWS Lambda? - AWS Lambda", "guide"],
      ["www.amazon.com", "https://www.amazon.com/dp/B08N5WRWNW", "Echo Dot (4th Gen)", "product_page"],
      // No /watch/ rule: it reads as video only because YouTube uses that path,
      // and YouTube is a video host already.
      ["www.apple.com", "https://www.apple.com/watch/", "Apple Watch - Apple", "unknown"],
      ["www.youtube.com", "https://www.youtube.com/watch?v=aircAruvnKk", "But what is a neural network? | Chapter 1", "video"],
    ];
    for (const [domain, url, title, expected] of cases) {
      expect(classifySerpFormat({ domain, url, title }).value, title).toBe(expected);
    }
  });

  it("reads a Chinese question asked either way round", () => {
    // 什么是X is the ordinary phrasing and only the postposed X是什么 matched,
    // so most Chinese explainers were unclassified. Word order still decides
    // between an article about a calculator and the calculator itself.
    const cases: readonly [string, string][] = [
      ["什么是 API？ - API 详解 - AWS", "guide"],
      ["什麼是上升星座", "guide"],
      ["上升星座是什麼", "guide"],
      ["什么是星盘计算器", "guide"],
      ["星盤計算器是什麼", "tool"],
    ];
    for (const [title, expected] of cases) {
      expect(classifySerpFormat({ domain: "x.example", url: "https://x.example/a", title }).value, title).toBe(expected);
    }
  });
});

describe("classifySerpFormat: a news host is a fallback, not a format", () => {
  it("lets a title say what a news publisher published", () => {
    // 67 headlines were fetched from these four hosts and labelled by what the
    // page is. With the host deciding first, 18 were right; with it deciding
    // last, 25. Every row below is one of those, verbatim.
    const cases: readonly [string, string, string][] = [
      ["https://www.bbc.com/sport/football/articles/c2k7w0k9ky9o", "Bundesliga: What is the 50+1 ownership rule? - BBC Sport", "guide"],
      ["https://www.bbc.com/sport/formula1/articles/cg4gzvlnpx7o", "Formula 1: What is sandbagging in F1? - BBC Sport", "guide"],
      ["https://www.bbc.com/travel/article/20260101-the-20-best-places-to-travel-in-2026", "The 20 best places to travel in 2026", "listicle"],
      ["https://www.bbc.com/travel/article/20260401-how-to-shop-for-perfume-in-paris", "How to shop for perfume in Paris like a Parisian", "guide"],
      // "vs" in a fight preview, and the page is a reference: the how-to-follow
      // rule reaches it first, which is the right answer for the right reason.
      ["https://www.bbc.com/sport/boxing/articles/cy0z5pej8dlo", "Ryan Garcia vs Conor Benn: Date, ringwalk, UK time, undercard, venue, records & how to follow on the BBC - BBC Sport", "guide"],
    ];
    for (const [url, title, expected] of cases) {
      expect(classifySerpFormat({ domain: new URL(url).hostname, url, title }).value, title).toBe(expected);
    }
  });

  it("still calls a report on a news host news, and pays for it once", () => {
    const news: readonly [string, string][] = [
      ["https://www.bbc.com/news/articles/c8jdev0422jo", "US-Canada tariffs: Canada braces for prolonged trade war as counter-tariffs on US take effect"],
      ["https://www.bbc.com/news/articles/c780nlgyd79o", "Ukraine's chief prosecutor resigns over call centre corruption scandal"],
      ["https://www.bbc.com/news/articles/czezydp4l97o", "Indonesia airports reopen after volcano eruption leaves 340,000 stranded"],
      // A superlative and a number in a dated report; neither rule reads them.
      ["https://www.bbc.com/news/articles/c5y5kn143d1o", "Singapore: Highest paid world leader Lawrence Wong to get salary increase of $1 million"],
    ];
    for (const [url, title] of news) {
      expect(classifySerpFormat({ domain: new URL(url).hostname, url, title }).value, title).toBe("news");
    }
    // The one row of fifteen that the census says this costs: a dated report on
    // drought damage whose headline is phrased as a how-to. It is recorded
    // here because the trade was measured, not assumed.
    expect(
      classifySerpFormat({
        domain: "www.bbc.com",
        url: "https://www.bbc.com/news/articles/cddvy47d253o",
        title: "Drought devastation: How to save London's parched trees",
      }).value,
    ).toBe("guide");
  });
});
