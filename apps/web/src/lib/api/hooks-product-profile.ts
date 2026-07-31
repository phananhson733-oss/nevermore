"use client";

import {
  useMutation,
  useQuery,
  useQueryClient,
  type QueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";
import {
  AddProductProfileCompetitorRequest,
  ConfirmProductProfileRequest,
  CreateProductProfileSynthesisRunRequest,
  ReviewProductProfileCompetitorRequest,
  UpdateProductProfileDraftRequest,
  type AddProductProfileCompetitorRequest as AddCompetitorBody,
  type ConfirmedProductProfileRowDto,
  type ConfirmProductProfileRequest as ConfirmBody,
  type CreateProductProfileSynthesisRunRequest as SynthesisBody,
  type ProductProfileDraftRowDto,
  type ProductProfileRowDto,
  type ReviewProductProfileCompetitorRequest as ReviewCompetitorBody,
  type UpdateProductProfileDraftRequest as UpdateDraftBody,
} from "@sf/contracts";
import { apiGet, apiSend, type ApiError } from "./client";
import type { DataEnvelope } from "./types";

export type ProductProfileRunStatus =
  | "queued"
  | "running"
  | "completed"
  | "partial"
  | "failed"
  | "cancelled";

export interface ProductProfileRun {
  readonly id: string;
  readonly projectId: string;
  readonly kind: string;
  readonly status: ProductProfileRunStatus;
  readonly progress: {
    readonly phase: string;
    readonly current: number;
    readonly total: number | null;
    readonly messageKey: string;
  };
  readonly lastError: { readonly code: string; readonly summary: string } | null;
  readonly resultRef: { readonly type: string; readonly id: string } | null;
  readonly queuedAt: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
}

export interface ProductProfileWorkspace {
  readonly projectId: string;
  readonly currentProfile: ProductProfileRowDto | null;
  readonly confirmedProfile: ConfirmedProductProfileRowDto | null;
  readonly hasSynthesisAttemptForCurrentDraft: boolean;
  readonly activeSynthesisRun:
    | (ProductProfileRun & {
        readonly kind: "product_profile_synthesis";
        readonly status: "queued" | "running";
        readonly resultRef: null;
      })
    | null;
  readonly activeCrawlRun:
    | (ProductProfileRun & {
        readonly kind: "collection";
        readonly status: "queued" | "running";
        readonly resultRef: null;
      })
    | null;
}

export interface ProductProfileAsyncAccepted {
  readonly run: ProductProfileRun;
  readonly statusUrl: string;
  readonly resourceRef: { readonly type: string; readonly id: string } | null;
}

export interface ReviewProductProfileCompetitorVariables {
  readonly candidateId: string;
  readonly body: ReviewCompetitorBody;
}

export function productProfileQueryKey(projectId: string) {
  return ["product-profile", projectId] as const;
}

export function productProfileRunQueryKey(projectId: string, runId: string) {
  return ["product-profile-run", projectId, runId] as const;
}

export function buildProductProfileQueryOptions(
  projectId: string,
  initialData?: ProductProfileWorkspace,
) {
  return {
    queryKey: productProfileQueryKey(projectId),
    queryFn: () => getProductProfile(projectId),
    enabled: projectId.length > 0,
    ...(initialData === undefined
      ? {}
      : { initialData, refetchOnMount: false as const }),
  };
}

export async function getProductProfile(
  projectId: string,
): Promise<ProductProfileWorkspace> {
  const response = await apiGet<DataEnvelope<ProductProfileWorkspace>>(
    `/projects/${projectId}/product-profile`,
  );
  return response.data;
}

export async function updateProductProfileDraft(
  projectId: string,
  body: UpdateDraftBody,
): Promise<ProductProfileDraftRowDto> {
  const strictBody = UpdateProductProfileDraftRequest.parse(body);
  const response = await apiSend<DataEnvelope<ProductProfileDraftRowDto>>(
    "PATCH",
    `/projects/${projectId}/product-profile`,
    { body: strictBody },
  );
  return response.data;
}

export async function createProductProfileSynthesisRun(
  projectId: string,
  body: SynthesisBody,
  idempotencyKey: string = crypto.randomUUID(),
): Promise<ProductProfileAsyncAccepted> {
  const strictBody = CreateProductProfileSynthesisRunRequest.parse(body);
  const response = await apiSend<DataEnvelope<ProductProfileAsyncAccepted>>(
    "POST",
    `/projects/${projectId}/product-profile/synthesis-runs`,
    { body: strictBody, idempotencyKey },
  );
  return response.data;
}

export async function reviewProductProfileCompetitor(
  projectId: string,
  candidateId: string,
  body: ReviewCompetitorBody,
): Promise<ProductProfileDraftRowDto> {
  const strictBody = ReviewProductProfileCompetitorRequest.parse(body);
  const response = await apiSend<DataEnvelope<ProductProfileDraftRowDto>>(
    "PATCH",
    `/projects/${projectId}/product-profile/competitors/${candidateId}`,
    { body: strictBody },
  );
  return response.data;
}

export async function addProductProfileCompetitor(
  projectId: string,
  body: AddCompetitorBody,
): Promise<ProductProfileDraftRowDto> {
  const strictBody = AddProductProfileCompetitorRequest.parse(body);
  const response = await apiSend<DataEnvelope<ProductProfileDraftRowDto>>(
    "POST",
    `/projects/${projectId}/product-profile/competitors`,
    { body: strictBody },
  );
  return response.data;
}

export async function confirmProductProfile(
  projectId: string,
  body: ConfirmBody,
): Promise<ConfirmedProductProfileRowDto> {
  const strictBody = ConfirmProductProfileRequest.parse(body);
  const response = await apiSend<DataEnvelope<ConfirmedProductProfileRowDto>>(
    "POST",
    `/projects/${projectId}/product-profile/confirm`,
    { body: strictBody },
  );
  return response.data;
}

export async function getProductProfileRun(
  projectId: string,
  runId: string,
): Promise<ProductProfileRun> {
  const response = await apiGet<DataEnvelope<ProductProfileRun>>(
    `/projects/${projectId}/runs/${runId}`,
  );
  return response.data;
}

/**
 * Product Profile changes affect the read surface, project shell, source
 * readiness, and Growth Map governance. A confirmed competitor is projected
 * into the canonical Competitor Library in the same transaction, so keeping a
 * previously cached Growth Map would hide a real customer change for up to the
 * global stale window.
 */
export async function invalidateProductProfileQueries(
  queryClient: QueryClient,
  projectId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: productProfileQueryKey(projectId) }),
    queryClient.invalidateQueries({ queryKey: ["project", projectId] }),
    queryClient.invalidateQueries({ queryKey: ["workspace", projectId] }),
    queryClient.invalidateQueries({ queryKey: ["sources", projectId] }),
    queryClient.invalidateQueries({ queryKey: ["growth-map", projectId] }),
  ]);
}

export function useProductProfile(
  projectId: string,
  initialData?: ProductProfileWorkspace,
): UseQueryResult<ProductProfileWorkspace, ApiError> {
  return useQuery(buildProductProfileQueryOptions(projectId, initialData));
}

export function useProductProfileRun(
  projectId: string,
  runId: string,
): UseQueryResult<ProductProfileRun, ApiError> {
  return useQuery({
    queryKey: productProfileRunQueryKey(projectId, runId),
    queryFn: () => getProductProfileRun(projectId, runId),
    enabled: projectId.length > 0 && runId.length > 0,
    refetchInterval: (query) => {
      if (query.state.status === "error") return false;
      const status = query.state.data?.status;
      return status === undefined || status === "queued" || status === "running"
        ? 2_000
        : false;
    },
    refetchIntervalInBackground: false,
  });
}

function useProfileWrite<TData, TVariables>(
  projectId: string,
  mutationFn: (variables: TVariables) => Promise<TData>,
): UseMutationResult<TData, ApiError, TVariables> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => invalidateProductProfileQueries(queryClient, projectId),
  });
}

export function useUpdateProductProfileDraft(
  projectId: string,
): UseMutationResult<ProductProfileDraftRowDto, ApiError, UpdateDraftBody> {
  return useProfileWrite(projectId, (body) =>
    updateProductProfileDraft(projectId, body),
  );
}

export function useCreateProductProfileSynthesisRun(
  projectId: string,
): UseMutationResult<ProductProfileAsyncAccepted, ApiError, SynthesisBody> {
  return useProfileWrite(projectId, (body) =>
    createProductProfileSynthesisRun(projectId, body),
  );
}

export function useReviewProductProfileCompetitor(
  projectId: string,
): UseMutationResult<
  ProductProfileDraftRowDto,
  ApiError,
  ReviewProductProfileCompetitorVariables
> {
  return useProfileWrite(projectId, ({ candidateId, body }) =>
    reviewProductProfileCompetitor(projectId, candidateId, body),
  );
}

export function useAddProductProfileCompetitor(
  projectId: string,
): UseMutationResult<
  ProductProfileDraftRowDto,
  ApiError,
  AddCompetitorBody
> {
  return useProfileWrite(projectId, (body) =>
    addProductProfileCompetitor(projectId, body),
  );
}

export function useConfirmProductProfile(
  projectId: string,
): UseMutationResult<
  ConfirmedProductProfileRowDto,
  ApiError,
  ConfirmBody
> {
  return useProfileWrite(projectId, (body) =>
    confirmProductProfile(projectId, body),
  );
}
