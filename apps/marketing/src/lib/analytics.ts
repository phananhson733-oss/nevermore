// @input  — SPEC Part V event dictionary, change_logs table
// @output — trackEvent() fire-and-forget event tracking
// @pos    — 核心工具库，所有事件追踪的统一入口
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

import type { SupabaseClient } from "@supabase/supabase-js";

export type EventName =
  // SPEC 5.2: strategy system events
  | "discovery_run_completed"
  | "strategy_generated"
  | "backlog_published"
  | "optimization_decision_applied"
  | "manual_override_applied"
  | "outreach_task_created"
  | "outreach_sent"
  | "backlink_verified"
  | "backlink_lost"
  | "social_probe_published"
  | "social_probe_threshold_hit"
  | "seo_priority_promoted"
  | "measurement_failed_postmortem_created"
  | "legal_document_published"
  | "consent_banner_shown"
  | "consent_updated"
  | "oauth_connection_authorized"
  | "oauth_token_refreshed"
  | "oauth_connection_revoked"
  | "social_post_publish_requested"
  | "social_post_publish_approved"
  | "social_post_publish_blocked"
  | "platform_policy_violation_detected"
  | "waitlist_submitted"
  | "waitlist_profile_completed"
  | "welcome_email_sent"
  | "nurture_email_queued"
  | "blog_post_published"
  // SPEC 5.2a: supplementary events
  | "discovery_run_error"
  | "contact_form_submitted"
  | "product_created"
  | "site_probe_completed"
  | "consent_policy_updated"
  | "measurement_generated"
  // SPEC 6.2: governance events
  | "strategy_reorder_applied"
  | "auto_review_triggered"
  // SPEC 3.19: publish queue bridge events
  | "execution_output_enqueued"
  // SPEC 3.19: generic content events (all content types)
  | "content_publish_requested"
  | "content_publish_approved"
  | "content_publish_blocked"
  // SPEC 3.3 Phase 3.2: onboarding funnel events
  | "onboarding_completed"
  | "first_analysis_viewed"
  // SPEC Website Audit PRD §19: audit-only module events
  | "audit_run_created"
  | "export_generated"
  | "audit_create_started"
  | "overview_viewed"
  | "module_viewed"
  | "finding_opened"
  | "evidence_opened"
  | "url_detail_opened"
  | "compare_viewed";

interface TrackEventOptions {
  event: EventName;
  properties: Record<string, unknown>;
  userId?: string;
}

// P1-2 dedup contract (SPEC 3.3 Phase 3.2):
// Funnel-conversion events fire once per (user, product_id) — repeat views
// must NOT inflate the conversion counter. Activity/log events continue to
// insert on every call (the "event" is the activity itself, not a unique
// state transition).
//
// Enforcement is split across two layers:
//   1. The DB enforces a partial unique index on change_logs
//      (actor, changes->>'event', changes->>'product_id') scoped to
//      DEDUP_EVENTS values (see migration 20260510000000…).
//   2. This function routes dedup-eligible events through upsert with
//      ignoreDuplicates:true so the second call returns 0 rows instead of
//      a duplicate-key error.
const DEDUP_EVENTS: ReadonlySet<EventName> = new Set<EventName>([
  "first_analysis_viewed",
  "onboarding_completed",
]);

/** Server-side variant that accepts a Supabase client directly */
export async function trackEventServer(
  supabase: SupabaseClient,
  { event, properties, userId }: TrackEventOptions,
) {
  const actor = userId ?? "system";
  const changes = { event, ...properties, timestamp: new Date().toISOString() };

  try {
    if (DEDUP_EVENTS.has(event)) {
      // Dedup path — use a stable entity_id derived from (event, actor,
      // product_id) so the partial unique index can match. crypto.randomUUID
      // would defeat the index entirely.
      const productId =
        typeof properties.product_id === "string"
          ? properties.product_id
          : "none";
      const payload = {
        entity_type: "event",
        entity_id: `${event}:${actor}:${productId}`,
        action: "create",
        changes,
        actor,
      };
      await supabase.from("change_logs").upsert(payload, {
        onConflict: "entity_type,entity_id",
        ignoreDuplicates: true,
      });
      return;
    }

    await supabase.from("change_logs").insert({
      entity_type: "event",
      entity_id: crypto.randomUUID(),
      action: "create",
      changes,
      actor,
    });
  } catch {
    // TODO: replace with structured logging
  }
}
