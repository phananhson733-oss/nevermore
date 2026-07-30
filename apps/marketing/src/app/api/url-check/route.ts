// @input  -- POST body { url: string }
// @output -- JSON { data: { reachable, statusCode, error, errorKey } }
// @pos    -- URL reachability check API, used by product/trial wizards before submission
// Once this file is updated, update the header comment and the folder _DIR.md

import { apiSuccess, apiError } from "@/lib/api-response";
import { validateUrlPattern, isPrivateHost } from "@/lib/url-validation";
import dns from "dns/promises";

const TIMEOUT_MS = 5000;

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
};

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { url } = body as { url?: string };
  if (!url || typeof url !== "string") {
    return apiError("MISSING_FIELD", "url is required", 400);
  }

  // 1. Pattern validation
  const pattern = validateUrlPattern(url);
  if (!pattern.valid) {
    return apiSuccess({
      reachable: false,
      statusCode: null,
      error: "PATTERN_INVALID",
      errorKey: pattern.errorKey,
    });
  }

  const parsed = new URL(url);
  const hostname = parsed.hostname;

  // 2. DNS resolution
  try {
    await dns.resolve(hostname);
  } catch {
    return apiSuccess({
      reachable: false,
      statusCode: null,
      error: "DNS_FAILED",
      errorKey: "urlDnsError",
    });
  }

  // 3. HTTP HEAD request with SSRF protection
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      redirect: "manual",
      headers: BROWSER_HEADERS,
    });

    // Follow redirects manually with SSRF check (max 3 hops)
    let finalStatus = res.status;
    let redirectUrl = res.headers.get("location");
    let hops = 0;

    while (
      finalStatus >= 300 &&
      finalStatus < 400 &&
      redirectUrl &&
      hops < 3
    ) {
      const redirectParsed = new URL(redirectUrl, url);
      if (isPrivateHost(redirectParsed.hostname)) {
        return apiSuccess({
          reachable: false,
          statusCode: null,
          error: "SSRF_BLOCKED",
          errorKey: "urlPrivateIp",
        });
      }
      const redirectRes = await fetch(redirectParsed.href, {
        method: "HEAD",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "manual",
        headers: BROWSER_HEADERS,
      });
      finalStatus = redirectRes.status;
      redirectUrl = redirectRes.headers.get("location");
      hops += 1;
    }

    // Some servers return 405 for HEAD, try GET as fallback
    if (finalStatus === 405) {
      const getRes = await fetch(url, {
        method: "GET",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "follow",
        headers: BROWSER_HEADERS,
      });
      finalStatus = getRes.status;
      // Consume body to avoid memory leak
      await getRes.text().catch(() => {});
    }

    if (finalStatus >= 500) {
      return apiSuccess({
        reachable: false,
        statusCode: finalStatus,
        error: "HTTP_ERROR",
        errorKey: "urlHttpError",
      });
    }

    return apiSuccess({
      reachable: true,
      statusCode: finalStatus,
      error: null,
      errorKey: null,
    });
  } catch (err) {
    const isTimeout =
      err instanceof Error &&
      (err.name === "TimeoutError" || err.name === "AbortError");

    return apiSuccess({
      reachable: false,
      statusCode: null,
      error: isTimeout ? "TIMEOUT" : "NETWORK_ERROR",
      errorKey: isTimeout ? "urlTimeout" : "urlUnreachable",
    });
  }
}
