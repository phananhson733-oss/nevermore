// @input  -- an admin API path, method and JSON body
// @output -- the parsed answer, plus a Chinese sentence for any error code the admin APIs return
// @pos    -- the one fetch wrapper the admin task components share
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md

export interface AdminAnswer {
  readonly ok: boolean;
  readonly status: number;
  readonly data: Record<string, unknown> | null;
  readonly error: Record<string, unknown> | null;
}

export async function adminFetch(
  path: string,
  method: "POST" | "PUT" | "DELETE",
  body?: unknown,
): Promise<AdminAnswer> {
  try {
    const response = await fetch(path, {
      method,
      headers: body === undefined ? {} : { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await response.json().catch(() => null)) as
      | { data?: Record<string, unknown>; error?: Record<string, unknown> }
      | null;
    return {
      ok: response.ok,
      status: response.status,
      data: json?.data ?? null,
      error: json?.error ?? null,
    };
  } catch {
    return { ok: false, status: 0, data: null, error: { code: "network" } };
  }
}

const MESSAGES: Readonly<Record<string, string>> = {
  network: "网络不通，请重试。",
  auth_unavailable: "登录服务暂时不可用。",
  auth_required: "登录已失效，请刷新页面重新登录。",
  not_found: "没找到，可能已被删除，或者你不在管理员名单里。",
  cross_origin: "请求来源不对，请在 gengrowth.ai 页面里操作。",
  tasks_unavailable: "任务数据库暂时不可用。",
  storage_unavailable: "R2 存储没配置或暂时不可用。",
  invalid_input: "有字段不合要求。",
  published_needs_target: "上架中的剧必须填推广目标地址。",
  upload_missing: "R2 里没找到刚传的文件，上传可能没完成。",
  upload_mismatch: "R2 里的文件大小或类型和申报的不一致，请重新上传。",
  invalid_key: "文件键不对。",
  invalid_file: "结算文件有问题。",
  unknown_codes: "文件里有没人领取过的推广码，整份文件没有导入。",
  payload_too_large: "文件太大。",
};

export function describeError(answer: AdminAnswer): string {
  const code = typeof answer.error?.code === "string" ? answer.error.code : "";
  const base = MESSAGES[code] ?? `请求失败（${answer.status || "无响应"}）。`;
  const fields = Array.isArray(answer.error?.fields) ? answer.error.fields.join("；") : "";
  return fields ? `${base} ${fields}` : base;
}
