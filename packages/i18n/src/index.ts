export * from "./config.ts";

import type { UiLocale } from "./config.ts";
import en from "./messages/en.json";
import zhCN from "./messages/zh-CN.json";

export type Messages = typeof en;

export function getMessages(locale: UiLocale): Messages {
  return locale === "zh-CN" ? zhCN : en;
}
