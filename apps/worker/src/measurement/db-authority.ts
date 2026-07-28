import {
  PublicationChangeReceipt,
  PublicationDeliveryReceipt,
} from "@sf/contracts";
import {
  ActionsRepository,
  AsyncRunsRepository,
  ExecutionArtifactsRepository,
  MeasurementWindowsRepository,
  PublicationsRepository,
  SitePagesRepository,
  type ProjectScope,
  type PublicationReceiptRow,
} from "@sf/db";
import type { WorkerContext } from "../context.ts";
import {
  MeasurementAuthorityError,
  type MeasurementExecutionDependencies,
  type MeasurementFrozenFacts,
} from "./run-measurement.ts";

/** Production authority backed only by canonical PostgreSQL projections. */
export function createDbMeasurementExecutionDependencies(
  ctx: WorkerContext,
): MeasurementExecutionDependencies {
  return {
    now: () => new Date(),
    loadEvidence: ({ scope, facts }) =>
      loadCanonicalEvidence(ctx, scope, facts),
    finalize: (input) =>
      ctx.db.transaction(async (tx) => {
        const runs = new AsyncRunsRepository(tx);
        if (!(await runs.lockAttemptForUpdate(input.attempt))) {
          return false;
        }
        await new MeasurementWindowsRepository(tx).appendFinalInTx(
          input.scope,
          {
            asyncRunId: input.attempt.runId,
            window: input.window,
            observationLineage: input.observationLineage,
          },
        );
        const terminalized = await runs.setTerminal(input.attempt, {
          status: "completed",
          resultType: "measurement_window",
          resultId: input.window.measurementWindowId,
        });
        if (!terminalized) {
          throw new Error(
            "measurement attempt ownership changed while locked",
          );
        }
        return true;
      }),
  };
}

async function loadCanonicalEvidence(
  ctx: WorkerContext,
  scope: ProjectScope,
  facts: MeasurementFrozenFacts,
) {
  const publications = new PublicationsRepository(ctx.db, {
    enqueue() {
      throw new Error("measurement evidence reader cannot enqueue");
    },
  });
  const history = await publications.loadAttemptHistory(
    scope,
    facts.publicationAttemptId,
  );
  if (!history) throw new MeasurementAuthorityError();

  const [action, artifact, artifactRevision, sitePage] =
    await Promise.all([
      new ActionsRepository(ctx.db).findById(scope, facts.actionId),
      new ExecutionArtifactsRepository(ctx.db).findById(
        scope,
        facts.artifactId,
      ),
      new ExecutionArtifactsRepository(ctx.db).findRevision(
        scope,
        facts.artifactId,
        facts.artifactRevision,
      ),
      new SitePagesRepository(ctx.db).findById(
        scope,
        facts.sitePageId,
      ),
    ]);
  const attempt = history.attempt;
  const publicationRun = history.run;
  if (
    !action ||
    !artifact ||
    !artifactRevision ||
    !sitePage ||
    attempt.id !== facts.publicationAttemptId ||
    attempt.site_id !== facts.siteId ||
    attempt.action_id !== facts.actionId ||
    attempt.artifact_id !== facts.artifactId ||
    attempt.artifact_revision_id !== facts.artifactRevisionId ||
    attempt.approved_artifact_revision !== facts.artifactRevision ||
    attempt.approved_artifact_content_hash !==
      facts.artifactContentHash ||
    attempt.content_checksum !== facts.contentChecksum ||
    publicationRun.kind !== "publication" ||
    !["completed", "partial"].includes(publicationRun.status) ||
    publicationRun.result_type !== "publication_attempt" ||
    publicationRun.result_id !== attempt.id ||
    action.id !== facts.actionId ||
    artifact.id !== facts.artifactId ||
    artifact.action_id !== facts.actionId ||
    artifactRevision.id !== facts.artifactRevisionId ||
    artifactRevision.artifact_id !== facts.artifactId ||
    artifactRevision.revision !== facts.artifactRevision ||
    artifactRevision.content_hash !== facts.artifactContentHash ||
    sitePage.id !== facts.sitePageId ||
    sitePage.site_id !== facts.siteId ||
    sitePage.normalized_url !== facts.url
  ) {
    throw new MeasurementAuthorityError();
  }

  const changeRow = history.receipts.find(
    (receipt) =>
      receipt.id === facts.changeReceiptId &&
      receipt.receipt_kind === "change_receipt",
  );
  const deliveryRow = history.receipts.find(
    (receipt) => receipt.receipt_kind === "delivery_receipt",
  );
  if (
    !changeRow ||
    !deliveryRow ||
    changeRow.predecessor_delivery_receipt_id !== deliveryRow.id
  ) {
    throw new MeasurementAuthorityError();
  }
  const verifiedChangeReceipt = PublicationChangeReceipt.parse(
    receiptProjection(changeRow),
  );
  const canonicalDelivery = PublicationDeliveryReceipt.parse(
    receiptProjection(deliveryRow),
  );
  if (
    verifiedChangeReceipt.liveCanonicalUrl !==
      facts.canonicalUrl ||
    (facts.timelineDeliveryReceiptId !== null &&
      facts.timelineDeliveryReceiptId !== canonicalDelivery.id)
  ) {
    throw new MeasurementAuthorityError();
  }

  const measurement = new MeasurementWindowsRepository(ctx.db);
  const evidenceInput = {
    siteId: facts.siteId,
    sitePageId: facts.sitePageId,
    window: {
      startAt: facts.beforeWindow.startAt,
      endAt: facts.afterWindow.endAt,
    },
  };
  const [gscEvidence, ga4Evidence, geoEvidence] = await Promise.all([
    measurement.listRelevantProviderEvidence(scope, {
      ...evidenceInput,
      provider: "gsc",
    }),
    measurement.listRelevantProviderEvidence(scope, {
      ...evidenceInput,
      provider: "ga4",
    }),
    measurement.listRelevantProviderEvidence(scope, {
      ...evidenceInput,
      provider: "geo",
    }),
  ]);
  return {
    verifiedChangeReceipt,
    timelineDeliveryReceipt:
      facts.timelineDeliveryReceiptId === null
        ? null
        : canonicalDelivery,
    providerEvidence: [
      ...gscEvidence,
      ...ga4Evidence,
      ...geoEvidence,
    ],
  };
}

function receiptProjection(row: PublicationReceiptRow) {
  return {
    id: row.id,
    providerKind: row.provider_kind,
    providerRequestId: row.provider_request_id,
    remoteScopeRef: row.remote_scope_ref,
    remoteObjectId: row.remote_object_id,
    remoteRevision: row.remote_revision,
    deliveryUrl: row.delivery_url,
    artifactContentHash: row.artifact_content_hash,
    contentChecksum: row.content_checksum,
    remoteFacts: row.remote_facts,
    observedAt: row.observed_at,
    receiptKind: row.receipt_kind,
    predecessorDeliveryReceiptId:
      row.predecessor_delivery_receipt_id,
    remoteObjectKind: row.remote_object_kind,
    liveCanonicalUrl: row.live_canonical_url,
    verificationState: row.verification_state,
    evidenceRefs: row.evidence_refs,
    limitation: row.limitation,
  };
}
