import { describe, expect, it } from "vitest";
import { AI_BOT_USER_AGENTS, emptyRobots, isPathAllowed, parseRobots } from "./robots.ts";

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

  it("honors the terminal $ anchor without treating it as a literal character", () => {
    const { groups } = parseRobots(
      "User-agent: *\nDisallow: /*.pdf$",
      ORIGIN,
      true,
    );

    expect(isPathAllowed(groups, "Googlebot", "/guide.pdf")).toBe(false);
    expect(isPathAllowed(groups, "Googlebot", "/guide.pdf?download=1")).toBe(
      true,
    );
  });

  it("merges every dedicated group for the same user agent", () => {
    const { groups } = parseRobots(
      [
        "User-agent: Googlebot",
        "Disallow: /private/",
        "",
        "User-agent: Googlebot",
        "Allow: /private/public/",
      ].join("\n"),
      ORIGIN,
      true,
    );

    expect(isPathAllowed(groups, "Googlebot", "/private/secret")).toBe(false);
    expect(isPathAllowed(groups, "Googlebot", "/private/public/guide")).toBe(
      true,
    );
  });
});
