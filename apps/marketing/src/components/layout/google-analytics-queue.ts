// @input  -- calls made through the public gtag function
// @output -- official gtag.js-compatible Arguments entries in dataLayer
// @pos    -- small testable adapter between React consent state and gtag.js

export type Gtag = (...args: unknown[]) => void;

/** Match the exact queue contract in Google's official gtag.js snippet. */
export function createGtag(dataLayer: unknown[]): Gtag {
  return function gtag() {
    // `arguments` is intentional: gtag.js consumes this array-like command
    // envelope, rather than the ordinary Array created by rest parameters.
    // eslint-disable-next-line prefer-rest-params
    dataLayer.push(arguments);
  };
}
