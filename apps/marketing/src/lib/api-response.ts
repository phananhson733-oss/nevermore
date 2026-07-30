// @input  — next/server NextResponse
// @output — apiSuccess() / apiError() 统一响应格式
// @pos    — API 工具层，供所有 API Route 使用（SPEC 8.5）
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { NextResponse } from "next/server";

export function apiSuccess<T>(data: T, status = 200) {
  return NextResponse.json({ data }, { status });
}

export function apiError(
  code: string,
  message: string,
  status = 400,
  details?: unknown,
) {
  return NextResponse.json({ error: { code, message, details } }, { status });
}

const INTERNAL_STATUS_THRESHOLD = 500;

/**
 * Safe variant of apiError that sanitizes internal error messages.
 * For status >= 500, replaces message with a generic one to prevent
 * leaking DB schema, constraint names, or infrastructure details.
 */
export function safeApiError(code: string, message: string, status = 500) {
  const safeMessage =
    status >= INTERNAL_STATUS_THRESHOLD
      ? "An internal error occurred"
      : message;
  return NextResponse.json(
    { error: { code, message: safeMessage } },
    { status },
  );
}
