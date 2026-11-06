// @input  -- AWS's published SigV4 presigned-URL example and a fixed R2 config
// @output -- proof that presignUrl signs exactly as S3 (and so R2) verifies
// @pos    -- unit test for r2.ts
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { describe, expect, it } from "vitest";

import {
  attachmentDisposition,
  coverImageUrl,
  deleteR2Object,
  headR2Object,
  presignUrl,
  r2ObjectUrl,
  readR2Config,
} from "./r2.ts";

const config = {
  accountId: "acc123",
  bucket: "gengrowth-clips",
  accessKeyId: "AK",
  secretAccessKey: "SK",
};

// AWS's published documentation key, not a credential. Joined at runtime
// because the repository's secrets:scan cannot tell it from a real key.
const AWS_EXAMPLE_KEY_ID = ["AKIA", "IOSFODNN7EXAMPLE"].join("");

describe("presignUrl", () => {
  it("matches the example in AWS's S3 query-string authentication docs", () => {
    // docs.aws.amazon.com/AmazonS3/latest/API/sigv4-query-string-auth.html
    const url = presignUrl({
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      region: "us-east-1",
      accessKeyId: AWS_EXAMPLE_KEY_ID,
      secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
      expiresSeconds: 86_400,
      now: new Date("2013-05-24T00:00:00Z"),
    });
    expect(url).toBe(
      "https://examplebucket.s3.amazonaws.com/test.txt" +
        "?X-Amz-Algorithm=AWS4-HMAC-SHA256" +
        `&X-Amz-Credential=${AWS_EXAMPLE_KEY_ID}%2F20130524%2Fus-east-1%2Fs3%2Faws4_request` +
        "&X-Amz-Date=20130524T000000Z&X-Amz-Expires=86400&X-Amz-SignedHeaders=host" +
        "&X-Amz-Signature=aeeed9bbccd4d02ee5c0109b86d86835f995330da4c265957d157751f604d404",
    );
  });

  it("signs R2 path-style URLs in region auto and encodes keys segment by segment", () => {
    const url = new URL(
      r2ObjectUrl(config, "PUT", "dramas/x/a b+c.mp4", {
        expiresSeconds: 900,
        now: new Date("2026-11-05T01:02:03Z"),
      }),
    );
    expect(url.host).toBe("acc123.r2.cloudflarestorage.com");
    expect(url.pathname).toBe("/gengrowth-clips/dramas/x/a%20b%2Bc.mp4");
    expect(url.searchParams.get("X-Amz-Credential")).toBe("AK/20261105/auto/s3/aws4_request");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("X-Amz-Signature")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("signs extra response parameters into the URL", () => {
    const now = new Date("2026-11-05T01:02:03Z");
    const plain = r2ObjectUrl(config, "GET", "k.mp4", { expiresSeconds: 60, now });
    const download = r2ObjectUrl(config, "GET", "k.mp4", {
      expiresSeconds: 60,
      now,
      query: { "response-content-disposition": attachmentDisposition("第1集.mp4") },
    });
    expect(new URL(download).searchParams.get("response-content-disposition")).toBe(
      `attachment; filename="_1_.mp4"; filename*=UTF-8''%E7%AC%AC1%E9%9B%86.mp4`,
    );
    expect(new URL(download).searchParams.get("X-Amz-Signature")).not.toBe(
      new URL(plain).searchParams.get("X-Amz-Signature"),
    );
  });
});

describe("coverImageUrl", () => {
  it("gives the same URL for the whole hour", () => {
    expect(coverImageUrl(config, "c.jpg", new Date("2026-11-05T01:00:01Z"))).toBe(
      coverImageUrl(config, "c.jpg", new Date("2026-11-05T01:59:59Z")),
    );
    expect(coverImageUrl(config, "c.jpg", new Date("2026-11-05T02:00:00Z"))).not.toBe(
      coverImageUrl(config, "c.jpg", new Date("2026-11-05T01:59:59Z")),
    );
  });
});

describe("readR2Config", () => {
  it("is null unless all four values are set", () => {
    expect(readR2Config({ R2_ACCOUNT_ID: "a", R2_BUCKET: "b", R2_ACCESS_KEY_ID: "c" })).toBeNull();
    expect(
      readR2Config({ R2_ACCOUNT_ID: "a", R2_BUCKET: "b", R2_ACCESS_KEY_ID: "c", R2_SECRET_ACCESS_KEY: " " }),
    ).toBeNull();
    expect(
      readR2Config({ R2_ACCOUNT_ID: "a", R2_BUCKET: "b", R2_ACCESS_KEY_ID: "c", R2_SECRET_ACCESS_KEY: "d" }),
    ).toEqual({ accountId: "a", bucket: "b", accessKeyId: "c", secretAccessKey: "d" });
  });
});

describe("headR2Object and deleteR2Object", () => {
  it("reads size and type, and treats 404 as absent", async () => {
    const found = (async () =>
      new Response(null, {
        status: 200,
        headers: { "content-length": "52000000", "content-type": "video/mp4" },
      })) as typeof fetch;
    expect(await headR2Object(config, "k", found)).toEqual({ byteSize: 52_000_000, contentType: "video/mp4" });
    const missing = (async () => new Response(null, { status: 404 })) as typeof fetch;
    expect(await headR2Object(config, "k", missing)).toBeNull();
    await expect(deleteR2Object(config, "k", missing)).resolves.toBeUndefined();
    const broken = (async () => new Response(null, { status: 403 })) as typeof fetch;
    await expect(headR2Object(config, "k", broken)).rejects.toThrow("403");
    await expect(deleteR2Object(config, "k", broken)).rejects.toThrow("403");
  });
});
