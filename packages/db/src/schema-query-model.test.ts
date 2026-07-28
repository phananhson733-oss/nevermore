import { describe, expect, it } from "vitest";
import {
  keywordReviewDecisions,
  publicationAttempts,
  publicationPreviewEvents,
  schema,
  topicClusterAliases,
  topicModelRevisions,
  topicNodeIdentities,
  topicNodeRevisions,
  topicNodeSuccessors,
} from "./schema.ts";

describe("production query model", () => {
  it("exposes the append-only Publication Preview authority and attempt binding", () => {
    expect(schema.publicationPreviewEvents).toBe(publicationPreviewEvents);
    expect(publicationPreviewEvents.preview_ref.name).toBe("preview_ref");
    expect(publicationPreviewEvents.facts_hash.name).toBe("facts_hash");
    expect(publicationAttempts.preview_event_id.name).toBe(
      "preview_event_id",
    );
    expect(publicationAttempts.preview_event_kind.name).toBe(
      "preview_event_kind",
    );
    expect(publicationAttempts.preview_facts_hash.name).toBe(
      "preview_facts_hash",
    );
  });

  it("exposes all six Topic-aware Keyword governance tables", () => {
    expect(schema.topicModelRevisions).toBe(topicModelRevisions);
    expect(schema.topicNodeIdentities).toBe(topicNodeIdentities);
    expect(schema.topicNodeRevisions).toBe(topicNodeRevisions);
    expect(schema.topicClusterAliases).toBe(topicClusterAliases);
    expect(schema.topicNodeSuccessors).toBe(topicNodeSuccessors);
    expect(schema.keywordReviewDecisions).toBe(keywordReviewDecisions);

    expect(topicModelRevisions.content_hash.name).toBe("content_hash");
    expect(topicNodeIdentities.initial_cluster_key.name).toBe(
      "initial_cluster_key",
    );
    expect(topicNodeRevisions.topic_model_revision.name).toBe(
      "topic_model_revision",
    );
    expect(topicClusterAliases.valid_from_revision.name).toBe(
      "valid_from_revision",
    );
    expect(topicNodeSuccessors.successor_kind.name).toBe("successor_kind");
    expect(keywordReviewDecisions.reviewed_projection.name).toBe(
      "reviewed_projection",
    );
  });
});
