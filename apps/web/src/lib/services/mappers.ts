import type { IcpProfileRow, ProjectRow, SiteRow } from "@sf/db";

/**
 * Row → API DTO mappers (spec §11.1: JSON is camelCase, DB is snake_case; the
 * repository boundary maps explicitly). These shapes match the OpenAPI `Project`,
 * `Site`, and `IcpProfile` schemas exactly.
 */

export type ContextStatus = "missing" | "draft" | "complete";

export interface SiteDto {
  id: string;
  origin: string;
  host: string;
  marketCodes: string[];
  languageCodes: string[];
}

export interface ProjectDto {
  id: string;
  clientName: string;
  projectName: string;
  stage: string;
  site: SiteDto;
  contextStatus: ContextStatus;
  currentIcpProfileVersion: number | null;
  defaultDeliveryLocale: string;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

export interface IcpProfileDto {
  id: string;
  projectId: string;
  version: number;
  status: "draft" | "complete";
  profile: Record<string, unknown>;
  contentHash: string;
  createdAt: string;
}

export function toSiteDto(site: SiteRow): SiteDto {
  return {
    id: site.id,
    origin: site.origin,
    host: site.host,
    marketCodes: site.market_codes,
    languageCodes: site.language_codes,
  };
}

export function toProjectDto(
  project: ProjectRow,
  site: SiteRow,
  currentIcp: IcpProfileRow | null,
): ProjectDto {
  const contextStatus: ContextStatus = currentIcp ? currentIcp.status : "missing";
  return {
    id: project.id,
    clientName: project.client_name,
    projectName: project.project_name,
    stage: project.stage,
    site: toSiteDto(site),
    contextStatus,
    currentIcpProfileVersion: currentIcp ? currentIcp.version : null,
    defaultDeliveryLocale: project.default_delivery_locale,
    createdAt: project.created_at,
    updatedAt: project.updated_at,
    archivedAt: project.archived_at,
  };
}

export function toIcpProfileDto(row: IcpProfileRow): IcpProfileDto {
  return {
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    status: row.status,
    profile: row.profile,
    contentHash: row.content_hash,
    createdAt: row.created_at,
  };
}
