---
title: Cookie 政策
version: 1.2
effectiveDate: 2026-08-12
status: published
---

本页列出 GenGrowth 设置的每一个 cookie、它的用途和有效期。本页是
[隐私政策](/zh/privacy)的配套说明。

## 严格必要

这些 cookie 使站点得以运转。没有它们，登录、SEO Agent 以及 Search Console
连接都无法工作。

| Cookie | 用途 | 有效期 |
| --- | --- | --- |
| `sb-<项目>-auth-token` | 你的登录会话。作用域为 `gengrowth.ai`，因此一次登录同时覆盖营销站和产品站。HTTP-only。 | 至退出登录或过期 |
| `gg_onetap` | 一次性随机数，把一次 Google 登录绑定到发起它的那次页面加载，使被截获的令牌无法重放。加密，HTTP-only。 | 10 分钟 |
| `gg_oauth_tx` | 保存进行中的 Google 授权交换过程。加密，HTTP-only。 | 10 分钟 |
| `gg_id` | 记住是哪个 Google 身份授权了 Search Console，避免每次访问都重新询问。加密，HTTP-only。 | 30 天 |
| `gg_gsc` | 你的 Search Console **只读**访问令牌，以及用于续期的刷新令牌——它让你再次访问时不必重新经过同意屏幕。加密，HTTP-only，且仅发送至 `/api` 路径。 | 30 天，每次使用后顺延，自授权当日起最长 90 天 |
| `gg_sites` | 你已授权的 Search Console 资源列表，供页面展示选择。加密，HTTP-only。 | 同 `gg_gsc` |
| `NEXT_LOCALE` | 你选择的界面语言。 | 1 年 |

`gg_*` 系列都经过密封处理：每种用途使用各自派生的密钥，因此为某一用途签发的值
无法被当作另一用途使用。

## 分析统计

| Cookie | 用途 | 有效期 |
| --- | --- | --- |
| `_ga` | Google Analytics 4 —— 区分访客。 | 2 年 |
| `_ga_71TET2Y97Q` | Google Analytics 4 —— 维持本站的会话状态。 | 2 年 |

## 我们不设置什么

我们不设置广告 cookie，不使用跨站追踪像素，除 Google Analytics 外不使用其他
第三方 cookie（你在 `accounts.google.com` 上登录时 Google 自身设置的 cookie 除外）。

## 管理 cookie

你可以在浏览器设置中清除或阻止 cookie。阻止“严格必要”类会导致登录、SEO 与 Tech
Agent 运行以及 Search Console 相关工具无法使用；不依赖这些 cookie 的无状态计算器
页面仍可能正常运行。

如需单独退出 Google Analytics，可安装 Google 的
[停用插件](https://tools.google.com/dlpage/gaoptout)。

如需结束 Search Console 连接，可在任一已连接的工具页点击**断开**。它会在同一步
里清除这些 cookie 并向 Google 撤销我们的访问权限。退出登录同样如此。

你也可以前往
[Google 账号权限页](https://myaccount.google.com/permissions)撤销。撤销立即生效，
与浏览器中是否仍残留 cookie 无关。

## 变更

cookie 集合发生变化时，我们会更新页首的版本号与生效日期。
