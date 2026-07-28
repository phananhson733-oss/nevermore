import { UpdateCompetitorMonitorRequest } from "@sf/contracts";

import { operatorRoute } from "@/lib/http/handler";
import { ok } from "@/lib/http/respond";
import { parseJsonBody, parseUuidParam } from "@/lib/http/validate";
import {
  getProjectAuditCompetitorMonitor,
  updateProjectAuditCompetitorMonitor,
} from "@/lib/services/growth-map-competitor-monitor";

/** Read-only Growth Map projection for approved competitors and real evidence. */
export const GET = operatorRoute<{ projectId: string }>(
  async (_request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const result = await getProjectAuditCompetitorMonitor(
      { workspaceId: ctx.operator.workspaceId },
      id,
    );
    return ok(result, ctx.requestId);
  },
);

/** Enable or pause the only supported real cadence: one calendar month. */
export const PUT = operatorRoute<{ projectId: string }>(
  async (request, ctx, routeCtx) => {
    const { projectId } = await routeCtx.params;
    const id = parseUuidParam(projectId);
    const body = await parseJsonBody(
      request,
      UpdateCompetitorMonitorRequest,
    );
    const result = await updateProjectAuditCompetitorMonitor(
      { workspaceId: ctx.operator.workspaceId },
      id,
      ctx.operator.userId,
      body,
    );
    return ok(result, ctx.requestId);
  },
);

export const dynamic = "force-dynamic";
