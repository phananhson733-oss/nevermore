import { describe, expect, it } from "vitest";
import { canonicalGeoV2Text, geoV2JsonbBytes } from "./kb-v2-json.ts";
import { geoV2Digest } from "./kb-v2-digest.ts";
describe("v2 canonical JSON", () => {
  it("sorts keys and safely represents integer metadata without changing array order", () => {
    expect(canonicalGeoV2Text({ z: [null, true, "中文"], version: 3 })).toBe('{"version":3,"z":[null,true,"中文"]}');
    expect(geoV2JsonbBytes({ z: [null, true, "中文"], version: 3 })).toBe(Buffer.byteLength('{"version": 3, "z": [null, true, "中文"]}'));
    expect(geoV2Digest({ b: 1, a: "2" })).toBe(geoV2Digest({ a: "2", b: 1 }));
  });
  it.each([Number.NaN, Infinity, 0.01, Number.MAX_SAFE_INTEGER + 1, undefined, new Date(), "bad\u0000text"])("rejects unsafe value %j", value => expect(() => canonicalGeoV2Text({ value })).toThrow());
});
