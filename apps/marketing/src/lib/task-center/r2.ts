// @input  -- R2_ACCOUNT_ID, R2_BUCKET, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY
// @output -- time-limited S3 SigV4 URLs for R2: the browser PUTs uploads and GETs clips with them, and gets hour-aligned URLs for public images (covers, stills); the server HEADs, PUTs a fetched cover, and DELETEs; the fixed key of a clip's still
// @pos    -- the only code that talks to Cloudflare R2; nothing else ever sees the R2 secret
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
//
// Hand-rolled with node:crypto because a presigned URL is a few HMACs and the
// AWS SDK is not in this workspace. The algorithm is AWS's "query string
// authentication" for S3; r2.test.ts checks it against AWS's published example.

import { createHash, createHmac } from "node:crypto";

export interface R2Config {
  readonly accountId: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

/** Null when any of the four is missing: uploads and clip links are then unavailable. */
export function readR2Config(env: Readonly<Record<string, string | undefined>> = process.env): R2Config | null {
  const accountId = env.R2_ACCOUNT_ID?.trim();
  const bucket = env.R2_BUCKET?.trim();
  const accessKeyId = env.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY?.trim();
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) return null;
  return { accountId, bucket, accessKeyId, secretAccessKey };
}

export type PresignMethod = "GET" | "PUT" | "HEAD" | "DELETE";

export interface PresignRequest {
  readonly method: PresignMethod;
  readonly host: string;
  /** Already the URL path, starting with "/"; each segment is encoded here. */
  readonly path: string;
  readonly region: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly expiresSeconds: number;
  readonly now: Date;
  /** Extra signed query parameters, e.g. response-content-disposition. */
  readonly query?: Readonly<Record<string, string>>;
}

/** RFC 3986 unreserved characters stay; everything else is %XX, as SigV4 requires. */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodePath(path: string): string {
  return path.split("/").map(encodeRfc3986).join("/");
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac("sha256", key).update(data, "utf8").digest();
}

function amzDate(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

export function presignUrl(request: PresignRequest): string {
  const timestamp = amzDate(request.now);
  const day = timestamp.slice(0, 8);
  const scope = `${day}/${request.region}/s3/aws4_request`;
  const params: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${request.accessKeyId}/${scope}`,
    "X-Amz-Date": timestamp,
    "X-Amz-Expires": String(request.expiresSeconds),
    "X-Amz-SignedHeaders": "host",
    ...request.query,
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((key) => `${encodeRfc3986(key)}=${encodeRfc3986(params[key]!)}`)
    .join("&");
  const canonicalPath = encodePath(request.path);
  const canonicalRequest = [
    request.method,
    canonicalPath,
    canonicalQuery,
    `host:${request.host}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    scope,
    createHash("sha256").update(canonicalRequest, "utf8").digest("hex"),
  ].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${request.secretAccessKey}`, day), request.region), "s3"),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign, "utf8").digest("hex");
  return `https://${request.host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

export function r2ObjectUrl(
  config: R2Config,
  method: PresignMethod,
  key: string,
  options: {
    readonly expiresSeconds: number;
    readonly now?: Date;
    readonly query?: Readonly<Record<string, string>>;
  },
): string {
  return presignUrl({
    method,
    host: `${config.accountId}.r2.cloudflarestorage.com`,
    path: `/${config.bucket}/${key}`,
    region: "auto",
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    expiresSeconds: options.expiresSeconds,
    now: options.now ?? new Date(),
    query: options.query,
  });
}

/**
 * An image anyone may see: a cover or a clip's still. Signing at the top of the hour gives every visitor the same URL for
 * that hour, so browsers can cache it; the two-hour lifetime keeps a page
 * rendered at :59 working.
 */
export function publicObjectUrl(config: R2Config, key: string, now = new Date()): string {
  const hour = new Date(Math.floor(now.getTime() / 3_600_000) * 3_600_000);
  return r2ObjectUrl(config, "GET", key, { expiresSeconds: 7_200, now: hour });
}

/** Cover images are public; see publicObjectUrl. */
export function coverImageUrl(config: R2Config, key: string, now = new Date()): string {
  return publicObjectUrl(config, key, now);
}

/** Where a video clip's poster still lives; one per clip, named by its asset id. */
export function posterKeyFor(dramaId: string, assetId: string): string {
  return `dramas/${dramaId}/posters/${assetId}.jpg`;
}

/** `filename*` carries any script; the plain `filename` is an ASCII fallback. */
export function attachmentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeRfc3986(fileName)}`;
}

export interface R2ObjectHead {
  readonly byteSize: number;
  readonly contentType: string | null;
}

/** Asks R2 whether the object exists, and its size and type. Null when it does not. */
export async function headR2Object(
  config: R2Config,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<R2ObjectHead | null> {
  const response = await fetchImpl(r2ObjectUrl(config, "HEAD", key, { expiresSeconds: 60 }), {
    method: "HEAD",
    cache: "no-store",
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`R2 HEAD answered ${response.status}`);
  return {
    byteSize: Number(response.headers.get("content-length") ?? "NaN"),
    contentType: response.headers.get("content-type"),
  };
}

/** Writes a small object from the server: a cover fetched from 北斗 at import. */
export async function putR2Object(
  config: R2Config,
  key: string,
  bytes: Uint8Array<ArrayBuffer>,
  contentType: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 30_000,
): Promise<void> {
  const response = await fetchImpl(r2ObjectUrl(config, "PUT", key, { expiresSeconds: 60 }), {
    method: "PUT",
    headers: { "content-type": contentType },
    body: bytes,
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`R2 PUT answered ${response.status}`);
}

export async function deleteR2Object(
  config: R2Config,
  key: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const response = await fetchImpl(r2ObjectUrl(config, "DELETE", key, { expiresSeconds: 60 }), {
    method: "DELETE",
    cache: "no-store",
  });
  // 204 deleted, 404 already gone: both leave nothing behind.
  if (!response.ok && response.status !== 404) {
    throw new Error(`R2 DELETE answered ${response.status}`);
  }
}
