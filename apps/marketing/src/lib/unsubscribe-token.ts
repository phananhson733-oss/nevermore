// @input  — crypto, 环境变量 UNSUBSCRIBE_SECRET (required, no fallback)
// @output — generateUnsubscribeToken(), validateUnsubscribeToken()
// @pos    — 退订令牌生成与验证，供 API Route 和 Email 调用
// 一旦本文件被更新，务必更新开头注释及所属文件夹的 _DIR.md
import { createHmac, timingSafeEqual } from "crypto";

function getSecret(): string {
  const secret = process.env.UNSUBSCRIBE_SECRET;
  if (!secret) {
    throw new Error("UNSUBSCRIBE_SECRET environment variable is required");
  }
  return secret;
}

export function generateUnsubscribeToken(subscriberId: string): string {
  return createHmac("sha256", getSecret()).update(subscriberId).digest("hex");
}

export function validateUnsubscribeToken(
  subscriberId: string,
  token: string,
): boolean {
  const expected = generateUnsubscribeToken(subscriberId);
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(token));
  } catch {
    return false;
  }
}
