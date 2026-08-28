import { describe, expect, it } from "vitest";
import {
  AI_BOT_USER_AGENTS,
  emptyRobots,
  isPathAllowed,
  matchRobotsRule,
  parseRobots,
} from "./robots.ts";

const ORIGIN = "https://example.com";

const ROBOTS = [
  "# example policy",
  "User-agent: *",
  "Disallow: /admin/",
  "",
  "User-agent: GPTBot",
  "Disallow: /",
  "",
  "User-agent: ClaudeBot",
  "Disallow: /private/",
  "",
  "User-agent: SignalFrameBot",
  "Disallow: /private/",
  "Allow: /private/public-guide.html",
  "",
  "Sitemap: https://example.com/sitemap.xml",
  "Sitemap: /also.xml",
].join("\n");

function agents(groups: { readonly userAgent: string }[]): string[] {
  return groups.map((group) => group.userAgent.toLowerCase());
}

describe("parseRobots", () => {
  it("records file groups and their disallow/allow rules", () => {
    const { projection } = parseRobots(ROBOTS, ORIGIN, true);
    expect(projection.fetched).toBe(true);
    const wildcard = projection.groups.find((group) => group.userAgent === "*");
    expect(wildcard?.disallow).toEqual(["/admin/"]);
    const gptbot = projection.groups.find((group) => group.userAgent.toLowerCase() === "gptbot");
    expect(gptbot?.disallow).toEqual(["/"]);
  });

  it("always represents the required AI-crawler user agents", () => {
    const { projection } = parseRobots(ROBOTS, ORIGIN, true);
    const present = agents([...projection.groups]);
    for (const bot of AI_BOT_USER_AGENTS) {
      expect(present).toContain(bot.toLowerCase());
    }
  });

  it("resolves absolute and relative Sitemap declarations against the origin", () => {
    const { projection } = parseRobots(ROBOTS, ORIGIN, true);
    expect(projection.sitemaps).toContain("https://example.com/sitemap.xml");
    expect(projection.sitemaps).toContain("https://example.com/also.xml");
  });

  it("emptyRobots reports not-fetched but still lists the AI bots", () => {
    const { projection, groups } = emptyRobots();
    expect(projection.fetched).toBe(false);
    expect(groups).toEqual([]);
    expect(agents([...projection.groups])).toEqual(
      expect.arrayContaining(AI_BOT_USER_AGENTS.map((bot) => bot.toLowerCase())),
    );
  });
});

describe("isPathAllowed", () => {
  it("applies the * fallback for the product crawler and blocks disallowed paths", () => {
    const { groups } = parseRobots("User-agent: *\nDisallow: /admin/\n", ORIGIN, true);
    expect(isPathAllowed(groups, "SignalFrameBot/0.2", "/")).toBe(true);
    expect(isPathAllowed(groups, "SignalFrameBot/0.2", "/admin/settings")).toBe(false);
  });

  it("matches a dedicated group by product token and lets Allow win a tie", () => {
    const { groups } = parseRobots(ROBOTS, ORIGIN, true);
    expect(isPathAllowed(groups, "SignalFrameBot/0.2", "/private/secret.html")).toBe(false);
    expect(isPathAllowed(groups, "SignalFrameBot/0.2", "/private/public-guide.html")).toBe(true);
  });

  it("treats empty robots as fully allowed", () => {
    const { groups } = parseRobots("", ORIGIN, false);
    expect(isPathAllowed(groups, "SignalFrameBot/0.2", "/anything")).toBe(true);
  });
});

describe("matchRobotsRule", () => {
  it("anchors a trailing $ to the end of the path", () => {
    const { groups } = parseRobots(
      "User-agent: *\nDisallow: /*/private$\n",
      ORIGIN,
      true,
    );

    // Escaping before removing the `$` turned the anchor into a literal dollar
    // sign, so this rule used to match nothing it was written to match.
    expect(matchRobotsRule(groups, "SignalFrameBot/0.2", "/a/private")).toEqual({
      allowed: false,
      pattern: "/*/private$",
    });
    expect(isPathAllowed(groups, "SignalFrameBot/0.2", "/a/private/x")).toBe(
      true,
    );
    expect(isPathAllowed(groups, "SignalFrameBot/0.2", "/a/private$")).toBe(
      true,
    );
  });

  it("anchors an extension rule without swallowing longer paths", () => {
    const { groups } = parseRobots(
      "User-agent: *\nDisallow: /*.php$\n",
      ORIGIN,
      true,
    );
    expect(isPathAllowed(groups, "SignalFrameBot/0.2", "/a/x.php")).toBe(false);
    expect(isPathAllowed(groups, "SignalFrameBot/0.2", "/a/x.phpx")).toBe(true);
  });

  it("merges every record naming the same agent", () => {
    const { groups } = parseRobots(
      [
        "User-agent: GPTBot",
        "Disallow: /a/",
        "",
        "User-agent: GPTBot",
        "Disallow: /b/",
      ].join("\n"),
      ORIGIN,
      true,
    );

    // RFC 9309 2.2.1: the crawler obeys the union. Reading only the first
    // record drops a rule a site appended rather than merged by hand.
    expect(isPathAllowed(groups, "GPTBot", "/a/x")).toBe(false);
    expect(isPathAllowed(groups, "GPTBot", "/b/x")).toBe(false);
    expect(isPathAllowed(groups, "GPTBot", "/c/x")).toBe(true);
  });

  it("names the winning pattern and reports no rule as an allowance", () => {
    const { groups } = parseRobots(
      "User-agent: *\nDisallow: /a/\nAllow: /a/b\n",
      ORIGIN,
      true,
    );
    expect(matchRobotsRule(groups, "SignalFrameBot/0.2", "/a/b")).toEqual({
      allowed: true,
      pattern: "/a/b",
    });
    expect(matchRobotsRule(groups, "SignalFrameBot/0.2", "/z")).toEqual({
      allowed: true,
      pattern: null,
    });
  });

  it("keeps a query string in the path it matches against", () => {
    const { groups } = parseRobots(
      "User-agent: *\nDisallow: /*?\n",
      ORIGIN,
      true,
    );
    expect(isPathAllowed(groups, "SignalFrameBot/0.2", "/search?q=1")).toBe(
      false,
    );
    expect(isPathAllowed(groups, "SignalFrameBot/0.2", "/search")).toBe(true);
  });
});

describe("robots rule specificity", () => {
  it("does not let a trailing $ outrank an equally specific Allow", () => {
    const { groups } = parseRobots(
      "User-agent: *\nDisallow: /x$\nAllow: /x\n",
      ORIGIN,
      true,
    );

    // Both rules describe the same two octets. `$` matches none of its own,
    // so counting it as a character made the Disallow win a tie that RFC 9309
    // 2.2.2 gives to Allow.
    expect(matchRobotsRule(groups, "SignalFrameBot/0.2", "/x")).toEqual({
      allowed: true,
      pattern: "/x",
    });
  });

  it("still lets a longer anchored rule win on real octets", () => {
    const { groups } = parseRobots(
      "User-agent: *\nAllow: /a\nDisallow: /a/b$\n",
      ORIGIN,
      true,
    );
    expect(isPathAllowed(groups, "SignalFrameBot/0.2", "/a/b")).toBe(false);
    expect(isPathAllowed(groups, "SignalFrameBot/0.2", "/a/b/c")).toBe(true);
  });
});
