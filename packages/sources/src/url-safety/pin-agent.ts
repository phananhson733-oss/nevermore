import { isIP } from "node:net";
import { Agent } from "undici";

/**
 * Pin a guard-validated address for one request. The request URL still carries
 * the original hostname, so undici derives the HTTP Host header and TLS
 * certificate identity from that hostname while this lookup closes the DNS
 * rebinding window.
 */
export function createPinnedAgent(hostname: string, pinnedIp: string): Agent {
  const family = isIP(pinnedIp);
  if (family === 0) {
    throw new Error("Pinned crawl destination is not an IP address");
  }

  const tlsHostname = hostname.replace(/^\[|\]$/g, "");
  return new Agent({
    connect: {
      ...(isIP(tlsHostname) === 0 ? { servername: tlsHostname } : {}),
      lookup: (_host, options, callback) => {
        // Modern Node/undici may request `all: true`. In that mode the lookup
        // callback must receive an address array, not the scalar overload.
        if (options.all) {
          callback(null, [{ address: pinnedIp, family }]);
          return;
        }
        callback(null, pinnedIp, family);
      },
    },
  });
}
