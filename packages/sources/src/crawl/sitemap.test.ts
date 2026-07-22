import { describe, expect, it, vi } from "vitest";
import { collectSitemap } from "./sitemap.ts";

describe("collectSitemap exact fetch identities", () => {
  it("reports exact fetch targets internally without changing the persisted projection", async () => {
    const onMember = vi.fn();
    const projection = await collectSitemap(
      "https://example.com",
      ["https://example.com/sitemap.xml"],
      {
        fetchText: async () => `<urlset>
          <url><loc>https://example.com/docs/</loc></url>
          <url><loc>https://example.com/docs</loc></url>
        </urlset>`,
        onMember,
      },
    );

    expect(projection).toEqual({
      fetched: true,
      urlCount: 1,
      subjectUrls: ["https://example.com/docs"],
    });
    expect(onMember).toHaveBeenCalledTimes(2);
    expect(onMember).toHaveBeenNthCalledWith(1, {
      fetchUrl: "https://example.com/docs/",
      subjectUrl: "https://example.com/docs",
    });
    expect(onMember).toHaveBeenNthCalledWith(2, {
      fetchUrl: "https://example.com/docs",
      subjectUrl: "https://example.com/docs",
    });
  });
});
