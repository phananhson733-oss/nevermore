// @input  -- the two marketing Agent route identities
// @output -- shared AgentKind discriminator and exact route/API mappings
// @pos    -- compile-time boundary shared by Agent pages and client workbenches

import type { AgentKind as AuditAgentKind } from "../../lib/agents/audit-contract";

export type AgentKind = AuditAgentKind;

export const AGENT_PATH: Readonly<Record<AgentKind, string>> = {
  seo: "/agents/seo",
  tech: "/agents/tech",
};

export const AGENT_ENDPOINT: Readonly<Record<AgentKind, string>> = {
  seo: "/api/agents/seo/audit",
  tech: "/api/agents/tech/audit",
};
