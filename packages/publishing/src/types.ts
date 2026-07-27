import type { PublishingProvider } from "./errors";

export type RemoteRevisionPrecondition =
  | {
      readonly kind: "must_not_exist";
    }
  | {
      readonly kind: "match";
      readonly revision: string;
    };

export interface DeliveryObservation<TRemote> {
  readonly kind: "delivery";
  readonly provider: PublishingProvider;
  readonly state: "pending";
  readonly observedAt: string;
  readonly providerRequestId: string | null;
  /** SHA-256 of the exact provider content/payload UTF-8 bytes. */
  readonly contentChecksum: string;
  readonly remoteScopeRef: string;
  readonly remote: TRemote;
}

export interface ChangeObservation<TEvidence> {
  readonly kind: "change";
  readonly provider: PublishingProvider;
  readonly state: "verified";
  readonly observedAt: string;
  readonly predecessorDeliveryReceiptId: string;
  /** SHA-256 of the exact provider content/payload UTF-8 bytes. */
  readonly contentChecksum: string;
  readonly remoteScopeRef: string;
  readonly providerRequestId: string | null;
  readonly liveCanonicalUrl: string;
  readonly remoteRevision: string;
  readonly evidence: TEvidence;
}

export interface ReceiptLineageDelivery {
  readonly id: string;
  readonly provider: PublishingProvider;
  /** SHA-256 of the exact provider content/payload UTF-8 bytes. */
  readonly contentChecksum: string;
  readonly remoteScopeRef: string;
  readonly observedAt: string;
}

export interface ReceiptLineageChange {
  readonly predecessorDeliveryReceiptId: string;
  readonly provider: PublishingProvider;
  /** SHA-256 of the exact provider content/payload UTF-8 bytes. */
  readonly contentChecksum: string;
  readonly remoteScopeRef: string;
  readonly observedAt: string;
}
