// @input  -- the absolute image URLs the target page declares
// @output -- transferred bytes per image, or a named reason there are none
// @pos    -- the only place the Agent audit fetches a subresource
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import { fetchPublicResource } from "@sf/sources/public-http";
import {
  IMAGE_TRANSFER_BUDGET_BYTES,
  type ImageWeightRaw,
} from "@sf/public-tools/seo-audit/page-performance";

/**
 * How many images one run will weigh.
 *
 * A page can declare three hundred. Fetching all of them would spend more
 * requests on one page's decoration than the whole crawl spends on the site,
 * for a check whose published severity is a Tip. Images are weighed in
 * document order, so the ones a reader meets first are the ones measured.
 */
const MAX_IMAGES_MEASURED = 25;

/**
 * How many run at once.
 *
 * These all land on the visitor's own origin, and a burst of parallel requests
 * at a site we are also crawling is the behaviour that gets a crawler blocked.
 */
const CONCURRENCY = 4;

const TIMEOUT_MS = 6_000;

export type ImageWeightUnavailableReason =
  | "no_images_declared"
  | "no_image_could_be_fetched";

export type ImageWeightReadResult =
  | { readonly status: "ok"; readonly images: readonly ImageWeightRaw[] }
  | {
      readonly status: "unavailable";
      readonly reason: ImageWeightUnavailableReason;
    };

/**
 * Weighs one image without downloading more of it than the question needs.
 *
 * The body is capped at the budget itself, which makes the answer definitive in
 * both directions without ever trusting a `Content-Length` header:
 *
 * - the read completed under the cap, so the exact transferred size is known
 *   and it is below the budget;
 * - the read filled the cap, so the image is at least the budget's size and is
 *   over it, whatever its true total.
 *
 * A HEAD request would have been cheaper and is not reliable: plenty of origins
 * answer HEAD with no `Content-Length`, and a CDN that negotiates format by
 * `Accept` can answer HEAD about a different variant than it would send.
 */
async function weigh(url: string): Promise<ImageWeightRaw | null> {
  let result;
  try {
    result = await fetchPublicResource(url, {
      timeoutMs: TIMEOUT_MS,
      maxBodyBytes: IMAGE_TRANSFER_BUDGET_BYTES,
    });
  } catch {
    return null;
  }
  if (result.kind !== "ok") return null;
  // A redirect to an error page, or an origin answering 404 with a body, is not
  // an image weight. Only a page that served the thing is measured.
  if (result.finalStatus < 200 || result.finalStatus >= 300) return null;
  return {
    url,
    transferredBytes: result.bytes,
    // False means the cap cut it short, which is exactly "at least the budget".
    complete: result.bodyComplete,
  };
}

/** Runs `weigh` over the list, `CONCURRENCY` at a time, in order. */
async function weighAll(
  urls: readonly string[],
): Promise<readonly ImageWeightRaw[]> {
  const out: ImageWeightRaw[] = [];
  for (let start = 0; start < urls.length; start += CONCURRENCY) {
    const batch = await Promise.all(
      urls.slice(start, start + CONCURRENCY).map((url) => weigh(url)),
    );
    for (const measured of batch) {
      if (measured !== null) out.push(measured);
    }
  }
  return out;
}

export function createImageWeightReader(options: {
  readonly weighImage?: (url: string) => Promise<ImageWeightRaw | null>;
} = {}): (input: {
  readonly sources: readonly string[];
}) => Promise<ImageWeightReadResult> {
  const measure = options.weighImage;

  return async ({ sources }) => {
    const bounded = sources.slice(0, MAX_IMAGES_MEASURED);
    if (bounded.length === 0) {
      return { status: "unavailable", reason: "no_images_declared" };
    }
    const images =
      measure === undefined
        ? await weighAll(bounded)
        : (
            await Promise.all(bounded.map((url) => measure(url)))
          ).filter((entry): entry is ImageWeightRaw => entry !== null);

    // Not a pass. Every fetch failing means we learned nothing about this
    // page's images, and reporting "no image is over budget" would be a claim
    // about files we never received.
    if (images.length === 0) {
      return { status: "unavailable", reason: "no_image_could_be_fetched" };
    }
    return { status: "ok", images };
  };
}
