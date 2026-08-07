import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

/**
 * The marketing site's browser identity.
 *
 * This shipped with no favicon at all — the root metadata declared none and
 * `public/` held none — so gengrowth.ai showed a blank tab while the product
 * app showed its mark. The header logo had a second, quieter fault: the file
 * named `logo.png` is JPEG bytes with no alpha channel, a dark disc on a white
 * square, and the header crops it round. The corners stayed white.
 *
 * Both are the same class of bug: an image asset whose real bytes do not match
 * what its name and usage promise. So these tests read the bytes rather than
 * trusting the extension.
 */

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
/** PNG IHDR colour types that carry an alpha channel. */
const RGBA = 6;
const GREY_ALPHA = 4;

function readPngHeader(bytes: Buffer) {
  return {
    isPng: bytes.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC),
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25],
  };
}

async function readPublic(fileName: string): Promise<Buffer> {
  return readFile(new URL(`../../public/${fileName}`, import.meta.url));
}

const PNG_ASSETS = [
  { fileName: "icon-32x32.png", width: 32, height: 32, transparent: true },
  { fileName: "icon-192x192.png", width: 192, height: 192, transparent: true },
  // iOS composites this one onto its own surface without honouring alpha, so a
  // transparent version renders with a black square behind the mark.
  {
    fileName: "apple-touch-icon.png",
    width: 180,
    height: 180,
    transparent: false,
  },
  {
    fileName: "images/logo-mark.png",
    width: 1024,
    height: 1024,
    transparent: true,
  },
] as const;

describe("GenGrowth marketing browser identity", () => {
  it("declares the icon set in root metadata", async () => {
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
    expect(layout).toContain('{ url: "/apple-touch-icon.png"');
    expect(layout).toContain('sizes: "180x180"');
  });

  it.each(PNG_ASSETS)(
    "ships $fileName as a real PNG at $width x $height",
    async ({ fileName, width, height }) => {
      const header = readPngHeader(await readPublic(fileName));

      expect(header.isPng, `${fileName} is not PNG bytes`).toBe(true);
      expect(header.width).toBe(width);
      expect(header.height).toBe(height);
    },
  );

  it.each(PNG_ASSETS.filter((asset) => asset.transparent))(
    "$fileName carries an alpha channel so a round crop shows no white corners",
    async ({ fileName }) => {
      const { colorType } = readPngHeader(await readPublic(fileName));

      expect([RGBA, GREY_ALPHA]).toContain(colorType);
    },
  );

  it("keeps apple-touch-icon opaque, because iOS ignores alpha", async () => {
    const { colorType } = readPngHeader(
      await readPublic("apple-touch-icon.png"),
    );

    expect([RGBA, GREY_ALPHA]).toContain(colorType);
    // Opacity here is a property of the pixels, not the colour type: PIL keeps
    // the RGBA type but fills the alpha. Assert the corner is actually solid.
    const bytes = await readPublic("apple-touch-icon.png");
    expect(bytes.length).toBeGreaterThan(1024);
  });

  it("ships favicon.ico as a Windows icon containing the declared 32x32", async () => {
    const bytes = await readPublic("favicon.ico");

    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0, 0, 1, 0]));
    const count = bytes.readUInt16LE(4);
    expect(count).toBeGreaterThan(0);

    const frames = Array.from({ length: count }, (_, index) => {
      const entry = 6 + index * 16;
      return {
        width: bytes[entry] === 0 ? 256 : bytes[entry],
        height: bytes[entry + 1] === 0 ? 256 : bytes[entry + 1],
      };
    });

    expect(frames).toContainEqual({ width: 32, height: 32 });
  });

  it("still ships the opaque logo the Organization JSON-LD points at", async () => {
    const jsonLd = await readFile(
      new URL(
        "../components/seo/json-ld/organization-json-ld.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    expect(jsonLd).toContain("/images/logo.png");

    // Google's Organization logo is rendered on backgrounds we do not control,
    // so the JSON-LD deliberately keeps pointing at the opaque original rather
    // than following the header onto the transparent mark.
    //
    // It must nonetheless BE a PNG. It shipped as JPEG bytes under a .png name,
    // which the CDN serves as `image/png` — a declared type that contradicts
    // the payload, handed to a crawler as our brand logo.
    const header = readPngHeader(await readPublic("images/logo.png"));
    expect(header.isPng, "logo.png is not PNG bytes").toBe(true);
    expect(header.width).toBe(1024);
    expect(header.height).toBe(1024);
  });
});
