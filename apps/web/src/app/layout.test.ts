import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const PUBLIC_ASSETS = [
  {
    fileName: "icon-32x32.png",
    magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    width: 32,
    height: 32,
  },
  {
    fileName: "apple-touch-icon.png",
    magic: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    width: 180,
    height: 180,
  },
] as const;

describe("GenGrowth browser identity", () => {
  it("declares favicon, PNG, shortcut, and Apple Touch icons in root metadata", async () => {
    const layout = await readFile(
      new URL("./layout.tsx", import.meta.url),
      "utf8",
    );

    expect(layout).toContain('applicationName: "GenGrowth"');
    expect(layout).toContain(
      '{ url: "/favicon.ico", sizes: "32x32", type: "image/x-icon" }',
    );
    expect(layout).toContain(
      '{ url: "/icon-32x32.png", sizes: "32x32", type: "image/png" }',
    );
    expect(layout).toContain(
      'shortcut: [{ url: "/favicon.ico", type: "image/x-icon" }]',
    );
    expect(layout).toContain('url: "/apple-touch-icon.png"');
    expect(layout).toContain('sizes: "180x180"');
  });

  it.each(PUBLIC_ASSETS)(
    "ships $fileName as a real PNG with the declared dimensions",
    async ({ fileName, magic, width, height }) => {
      const bytes = await readFile(
        new URL(`../../public/${fileName}`, import.meta.url),
      );

      expect(bytes.subarray(0, magic.length)).toEqual(magic);
      expect(bytes.readUInt32BE(16)).toBe(width);
      expect(bytes.readUInt32BE(20)).toBe(height);
    },
  );

  it("ships favicon.ico as a Windows icon containing the declared 32x32, not renamed JPEG bytes", async () => {
    const bytes = await readFile(
      new URL("../../public/favicon.ico", import.meta.url),
    );

    // ICONDIR: reserved=0, type=1 (icon), then the image count.
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
    const count = bytes.readUInt16LE(4);
    expect(count).toBeGreaterThan(0);

    // The frame count is not the point — the point is that the size the root
    // metadata advertises is actually in the file. A multi-size .ico is better
    // than one 32px frame the browser has to rescale for a 16px tab, so this
    // reads the directory rather than pinning a single entry. A 0 byte means
    // 256 in the ICONDIRENTRY encoding.
    const frames = Array.from({ length: count }, (_, index) => {
      const entry = 6 + index * 16;
      return {
        width: bytes[entry] === 0 ? 256 : bytes[entry],
        height: bytes[entry + 1] === 0 ? 256 : bytes[entry + 1],
      };
    });

    expect(frames).toContainEqual({ width: 32, height: 32 });
  });

  it("ships the brand mark the app chrome renders", async () => {
    // The sidebar tile and the login card reach for this file through a plain
    // path string, so nothing here type-checks or bundles it: if it went
    // missing the app would keep building and just serve a broken image.
    const bytes = await readFile(
      new URL("../../public/images/logo-mark.png", import.meta.url),
    );

    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    // Colour type 6 = RGBA. The tile paints the brand navy itself, in both the
    // paper and ink themes, so the mark on top of it has to be transparent.
    expect(bytes[25]).toBe(6);

    for (const source of [
      "../components/app-shell/AppShell.tsx",
      "./login/page.tsx",
    ]) {
      const component = await readFile(
        new URL(source, import.meta.url),
        "utf8",
      );
      // Through withBasePath, not as a bare literal: a raw <img> src is a
      // hand-built same-origin URL, and Next prefixes <Link>, redirect() and
      // the assets it emits itself — not this. A sub-path deployment would
      // serve a broken image.
      expect(component, source).toContain(
        'withBasePath("/images/logo-mark.png")',
      );
    }
  });
});
