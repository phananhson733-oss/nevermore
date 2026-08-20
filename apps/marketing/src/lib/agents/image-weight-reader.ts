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
 *
 * Truncating here is a measurement gap, not a clean bill of health: the
 * twenty-sixth image can be the ten-megabyte one. A run that hits this cap
 * reports the cap rather than a pass — see `complete` on the result.
 */
const MAX_IMAGES_MEASURED = 25;

/**
 * How many run at once.
 *
 * A burst of parallel requests at a host we are also crawling is the behaviour
 * that gets a crawler blocked, and these often land on the audited site itself.
 */
const CONCURRENCY = 4;

const TIMEOUT_MS = 6_000;

/**
 * Outbound bytes one run will spend weighing images.
 *
 * The page being audited chooses these URLs, so without a run-level ceiling a
 * hostile page can point twenty-five fetches at a third party on every audit.
 * Bounding the total rather than the per-image size means the cost of a run is
 * fixed no matter what the page declares.
 */
const MAX_RUN_TRANSFER_BYTES = 3 * 1024 * 1024;

export type ImageWeightUnavailableReason =
  | "no_images_declared"
  | "no_image_could_be_fetched";

export type ImageWeightReadResult =
  | {
      readonly status: "ok";
      readonly images: readonly ImageWeightRaw[];
      /**
       * Whether every image the page declares was weighed.
       *
       * False when the cap truncated the list or a fetch failed. Without it,
       * "no image is over budget" is a claim about the images that happened to
       * answer — one 10 KB image plus twenty-four failures plus a 10 MB
       * twenty-sixth renders as a healthy page.
       */
      readonly complete: boolean;
    }
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
async function weigh(url: string): Promise<WeighOutcome> {
  let result;
  try {
    result = await fetchPublicResource(url, {
      timeoutMs: TIMEOUT_MS,
      maxBodyBytes: IMAGE_TRANSFER_BUDGET_BYTES,
    });
  } catch {
    // An attempt that reached the transport and then threw may have pulled a
    // body prefix before it died, and the failure carries no byte count — so
    // the ledger charges the most it could have cost. Over-charging is the
    // direction a ceiling may err in; charging zero is how five megabytes of
    // error bodies passed a three-megabyte cap without it seeing a byte.
    return { spentBytes: IMAGE_TRANSFER_BUDGET_BYTES, measured: null };
  }
  if (result.kind !== "ok") {
    return { spentBytes: IMAGE_TRANSFER_BUDGET_BYTES, measured: null };
  }
  // Every byte that arrived counts against the run, whatever the response
  // turned out to be. The transport reads the bounded body before the status
  // is inspected, so a page pointing twenty-five `<img>` at a host that answers
  // 500 with a 200 KB body transferred five megabytes while the ledger stayed
  // at zero — against a three-megabyte cap whose whole claim is that the cost
  // of a run is fixed no matter what the page declares.
  const spentBytes = result.bytes;
  // A redirect to an error page, or an origin answering 404 with a body, is not
  // an image weight. Only a page that served the thing is measured.
  if (result.finalStatus < 200 || result.finalStatus >= 300) {
    return { spentBytes, measured: null };
  }
  // Nor is an HTML error page served with a 200. Without this a page can
  // declare `<img src="/missing">`, answer with a two-kilobyte soft error, and
  // have it measured as a healthy small image — and if every declared image
  // does it, the set is called complete and 5.2 passes a page on which no
  // image was ever served.
  if (!isImageContentType(result.contentType)) {
    return { spentBytes, measured: null };
  }
  return {
    spentBytes,
    measured: {
      url,
      transferredBytes: result.bytes,
      // False means the cap cut it short, which is exactly "at least the budget".
      complete: result.bodyComplete,
    },
  };
}

export interface WeighOutcome {
  /** Bytes this attempt pulled over the wire, measurable or not. */
  readonly spentBytes: number;
  readonly measured: ImageWeightRaw | null;
}

/**
 * Whether the origin said it served an image.
 *
 * A missing type is NOT accepted, and the first version of this guard had it
 * the other way round on the argument that plenty of origins omit the header
 * and refusing them would report "cannot judge" about sites whose images are
 * fine. That trades the rule this product is built on for coverage: a missing
 * image route answering 200 with a small HTML fallback and no `Content-Type`
 * was measured as a healthy image, and if every declared source did it the set
 * read complete and 5.2 passed a page on which no image was ever served.
 *
 * Nothing here can check the bytes — the transport returns a length, not a
 * body — so an unstated type is genuinely "could not establish that this is an
 * image", and that is what it now reports. Losing coverage on origins that
 * omit the header is the acceptable direction; the other one is not.
 */
function isImageContentType(contentType: string | null): boolean {
  if (contentType === null) return false;
  return /^\s*image\//i.test(contentType);
}

/**
 * Runs `weigh` over the list, `CONCURRENCY` at a time, stopping at the budget.
 *
 * Off-origin images are fetched, because that is where real sites keep them: a
 * same-origin restriction reads as prudent and in practice reports "cannot
 * judge" on every site with a CDN, an image optimiser or object storage, which
 * is most of them. The private-network guard inside `fetchPublicResource` runs
 * on the initial URL and again on every redirect hop, so the SSRF surface is
 * already closed; what is left is outbound volume, and volume is what
 * `MAX_RUN_TRANSFER_BYTES` bounds. The cap is on the whole run rather than
 * per image, so a page cannot widen it by declaring more images.
 */
async function weighAll(
  urls: readonly string[],
  fetchOne: (url: string) => Promise<WeighOutcome> = weigh,
): Promise<{
  readonly images: readonly ImageWeightRaw[];
  /** True when the byte ceiling stopped the run before the list ran out. */
  readonly stoppedAtBudget: boolean;
}> {
  const out: ImageWeightRaw[] = [];
  let spent = 0;
  let stoppedAtBudget = false;
  for (let start = 0; start < urls.length; start += CONCURRENCY) {
    // Reserve what the batch about to launch could cost. Checking only what
    // has already been spent let a run sitting just under the ceiling start
    // four more reads and finish above it, so the stated number was never the
    // real bound. The concurrent worst case is subtracted up front instead.
    if (
      spent + CONCURRENCY * IMAGE_TRANSFER_BUDGET_BYTES >
      MAX_RUN_TRANSFER_BYTES
    ) {
      stoppedAtBudget = true;
      break;
    }
    const batch = await Promise.all(
      urls.slice(start, start + CONCURRENCY).map((url) => fetchOne(url)),
    );
    for (const outcome of batch) {
      // Charged whether or not it produced a measurement. The ledger used to
      // move only on success, so every byte spent on a 4xx, a 5xx or a
      // non-image was invisible to the cap that exists to bound exactly that.
      spent += outcome.spentBytes;
      if (outcome.measured !== null) out.push(outcome.measured);
    }
  }
  return { images: out, stoppedAtBudget };
}

export function createImageWeightReader(
  options: {
    /**
     * The single-image transport, injected in tests.
     *
     * Deliberately the leaf and not the whole measurement. The seam used to
     * replace `weighAll` itself, so every test bypassed the batching, the
     * concurrency limit, the byte ceiling and `weigh`'s own status and
     * content-type handling — the branch production actually takes, since the
     * handler constructs this reader with no arguments. Throwing on the first
     * line of `weighAll` left the whole suite green. Stubbing one fetch keeps
     * the code under test the code that ships.
     */
    readonly weighImage?: (url: string) => Promise<WeighOutcome>;
  } = {},
): (input: {
  readonly sources: readonly string[];
}) => Promise<ImageWeightReadResult> {
  return async ({ sources }) => {
    const bounded = sources.slice(0, MAX_IMAGES_MEASURED);
    if (bounded.length === 0) {
      return { status: "unavailable", reason: "no_images_declared" };
    }
    const { images, stoppedAtBudget } = await weighAll(
      bounded,
      options.weighImage,
    );

    // Not a pass. Every fetch failing means we learned nothing about this
    // page's images, and reporting "no image is over budget" would be a claim
    // about files we never received.
    if (images.length === 0) {
      return { status: "unavailable", reason: "no_image_could_be_fetched" };
    }
    return {
      status: "ok",
      images,
      // One condition, because it already covers all three ways an image can
      // go unlooked-at: the count cap truncating the list, the byte ceiling
      // ending the run, and an individual fetch coming back unusable each
      // leave fewer measurements than the page declared. Spelling the other
      // two out separately reads as extra protection and cannot change the
      // answer — a run stopped by the ceiling has always fetched fewer than it
      // was given. `stoppedAtBudget` is returned for the caller's benefit, not
      // consulted here.
      complete: images.length === sources.length,
    };
  };
}
