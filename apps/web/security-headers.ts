export interface SecurityHeader {
  readonly key: string;
  readonly value: string;
}

const CSP_NONCE = /^[A-Za-z0-9+/_=-]+$/;

/** Per-request nonce CSP. Next applies this nonce to its framework tags. */
export function buildContentSecurityPolicy(
  development: boolean,
  nonce: string,
): string {
  if (!CSP_NONCE.test(nonce)) {
    throw new Error("CSP nonce contains invalid characters.");
  }
  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    "'strict-dynamic'",
    ...(development ? ["'unsafe-eval'"] : []),
  ];
  const styleSources = development
    ? "'self' 'unsafe-inline'"
    : `'self' 'nonce-${nonce}'`;
  return [
    "default-src 'self'",
    `script-src ${scriptSources.join(" ")}`,
    // Next DevTools injects nonce-less development styles. A nonce alongside
    // unsafe-inline makes browsers ignore the latter, so the development
    // directive omits the nonce; production remains nonce-gated.
    `style-src ${styleSources}`,
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://accounts.google.com https://oauth2.googleapis.com https://www.googleapis.com",
    "media-src 'self'",
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** Static browser hardening; the request-specific CSP is set by `proxy.ts`. */
export function buildSecurityHeaders(): SecurityHeader[] {
  return [
    { key: "X-Frame-Options", value: "DENY" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    { key: "Cross-Origin-Resource-Policy", value: "same-origin" },
    {
      key: "Strict-Transport-Security",
      value: "max-age=31536000; includeSubDomains",
    },
  ];
}
