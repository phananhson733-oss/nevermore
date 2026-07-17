"use client";

/**
 * TanStack Query v5 hooks over the typed API client. TanStack Query owns
 * server-state; it is never copied into a hand-rolled global store (spec §3.2).
 * Each query hook unwraps the `{ data }` envelope so consumers read the entity
 * directly (the list hook keeps `meta` for cursor pagination).
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import type {
  CreateProjectRequest,
  UpdateContextRequest,
} from "@sf/contracts";
import { apiGet, apiSend, type ApiError } from "./client";
import type {
  DataEnvelope,
  IcpProfile,
  ListEnvelope,
  OverviewView,
  Project,
} from "./types";

export interface ProjectsListOptions {
  readonly cursor?: string;
  readonly limit?: number;
  readonly archived?: boolean;
}

function buildProjectsPath(opts?: ProjectsListOptions): string {
  const params = new URLSearchParams();
  if (opts?.cursor) params.set("cursor", opts.cursor);
  if (opts?.limit !== undefined) params.set("limit", String(opts.limit));
  if (opts?.archived !== undefined)
    params.set("archived", String(opts.archived));
  const qs = params.toString();
  return qs.length > 0 ? `/projects?${qs}` : "/projects";
}

/** List projects (cursor-paginated). Data is the full `{ data, meta }` envelope. */
export function useProjectsList(
  opts?: ProjectsListOptions,
): UseQueryResult<ListEnvelope<Project>, ApiError> {
  return useQuery({
    queryKey: ["projects", opts],
    queryFn: () => apiGet<ListEnvelope<Project>>(buildProjectsPath(opts)),
  });
}

/** Fetch a single project by id. */
export function useProject(
  projectId: string,
): UseQueryResult<Project, ApiError> {
  return useQuery({
    queryKey: ["project", projectId],
    queryFn: async () => {
      const res = await apiGet<DataEnvelope<Project>>(`/projects/${projectId}`);
      return res.data;
    },
    enabled: projectId.length > 0,
  });
}

/** Fetch the current ICP context profile (may be `null` when unset). */
export function useProjectContext(
  projectId: string,
): UseQueryResult<IcpProfile | null, ApiError> {
  return useQuery({
    queryKey: ["context", projectId],
    queryFn: async () => {
      const res = await apiGet<DataEnvelope<IcpProfile | null>>(
        `/projects/${projectId}/context`,
      );
      return res.data;
    },
    enabled: projectId.length > 0,
  });
}

/** Fetch a workspace projection. WP1 exposes only the `overview` view. */
export function useWorkspaceView(
  projectId: string,
  view: "overview" = "overview",
): UseQueryResult<OverviewView, ApiError> {
  return useQuery({
    queryKey: ["workspace", projectId, view],
    queryFn: async () => {
      const res = await apiGet<DataEnvelope<OverviewView>>(
        `/projects/${projectId}/workspace?view=${view}`,
      );
      return res.data;
    },
    enabled: projectId.length > 0,
  });
}

/**
 * Create a project. Generates a fresh `Idempotency-Key` per attempt and returns
 * the created `Project` (the caller reads `.site` etc. and navigates). On success
 * the projects list is invalidated.
 */
export function useCreateProject(): UseMutationResult<
  Project,
  ApiError,
  CreateProjectRequest
> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: CreateProjectRequest) => {
      const res = await apiSend<DataEnvelope<Project>>("POST", "/projects", {
        body,
        idempotencyKey: crypto.randomUUID(),
      });
      return res.data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["projects"] }),
  });
}

/**
 * Update a project's ICP context (draft or complete, carrying `baseVersion`).
 * On success both the context and the parent project are invalidated (the
 * project's `contextStatus` / `currentIcpProfileVersion` may change).
 */
export function useUpdateContext(
  projectId: string,
): UseMutationResult<IcpProfile, ApiError, UpdateContextRequest> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: UpdateContextRequest) => {
      const res = await apiSend<DataEnvelope<IcpProfile>>(
        "PATCH",
        `/projects/${projectId}/context`,
        { body },
      );
      return res.data;
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["context", projectId] }),
        queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
      ]);
    },
  });
}
