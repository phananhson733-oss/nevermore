# 营销站 Google 登录 + Search Console 授权配置

面向 gengrowth.ai（`apps/marketing`）。代码已就绪且默认关闭。

产品版本 0.3.0 · 最后更新 2026-08-07

> **2026-08-07 变更**：Search Console 授权改为 `access_type=offline`。refresh token 密封在访客自己浏览器的 cookie 里，服务端仍然什么都不存。第 4 节的 cookie 契约、第 3 节的敏感范围说明，以及提交 Google 的用途说明措辞都已按新实现重写——旧版本写的是"不申请 refresh token"，那句话现在是假的。

## 0. 先说结论：凭据不用新建

`gengrowth.ai` 的 OAuth client 在上一版代码库时期就已存在，Vercel 项目 `gengrowth-agents`（`prj_HzRnuXaewqxu27P013fUwh6D2fWV`）一直携带这三个变量：

| 变量 | 现状 |
|---|---|
| `GOOGLE_CLIENT_ID` | 已有，属于 GCP project **335450701160** |
| `GOOGLE_CLIENT_SECRET` | 已有 |
| `GOOGLE_REDIRECT_URI` | 已有，值为 `https://gengrowth.ai/api/auth/google/callback` |
| `TOKEN_ENCRYPTION_KEY` | 已有（hex），作为 cookie 密封的 root key 复用 |

**本次实现直接读这四个变量**，不新建 client、不新增必填变量。redirect URI 的路径与新路由 `/api/auth/google/callback` 恰好一致，GCP 侧无需改动。

这个 client 本来就是为 `gengrowth.ai` 域建的，与 `app.gengrowth.ai`（`apps/web`，另一个 Vercel 项目、另一套凭据）天然分离，符合"两站独立、不共用 secret"。

## 1. 唯一需要新增的变量

| 变量 | 用途 | 说明 |
|---|---|---|
| `MARKETING_GSC_CONNECT_ENABLED` | 总开关 | 只有值为 `"true"` 才开放授权入口 |

可选（不设则不需要）：

| 变量 | 用途 |
|---|---|
| `MARKETING_COOKIE_SECRET` | base64、≥32 字节。设置后 cookie 密封改用独立 root key，不与 `TOKEN_ENCRYPTION_KEY` 同源 |

未开启时的行为是**安全默认**：三个 auth 路由返回 404，工具页显示"连接尚未开放"，不会出现指向死链的按钮。

## 2. 与上一版实现的关系

旧代码库 `gengrowth-agents` 有 `/api/auth/google` + callback，但它解决的是另一个问题：

| | 旧实现 | 本次实现 |
|---|---|---|
| 使用者 | 已登录 Supabase 的用户 | 营销站访客（无账号） |
| 前置条件 | 必须带 `product_id` | 无 |
| token 去向 | AES 加密后写入 `data_connections` 表 | 密封进 `/api` 作用域 cookie，不落库 |
| 授权类型 | `access_type=offline` + refresh token 存服务端 | `access_type=offline` + refresh token 只存访客浏览器 |
| CSRF | 明文 cookie 存 state | 密封 cookie 存 state + **PKCE S256** |

两边都拿 refresh token，区别在**放哪里**：旧实现落库，我们密封进访客自己的 cookie。服务端没有任何一处保存凭据，撤销/删除也就不需要我们配合。

所以复用的是**凭据与 GCP 配置**，不是代码路径——旧流程要求一个营销站访客并不具备的东西（Supabase 账号 + 产品记录）。

## 3. GCP 侧唯一待确认项

**同意屏幕验证状态**（`webmasters.readonly` 是 sensitive scope）。旧代码库在生产用过这个 scope，因此大概率已过审或处于测试用户模式——需要去 Console 确认属于哪种：

- 已过审 → 直接开 `MARKETING_GSC_CONNECT_ENABLED=true`
- 仅测试用户 → 外部访客无法授权，需提交验证（应用首页、隐私政策 URL、scope 说明、演示视频）

授权被拆成两段，所以审核不阻塞第一步：

1. `/api/auth/google/start`（不带参数）只要 `openid email profile`，非敏感 scope，不需审核
2. `/api/auth/google/start?scope=gsc` 才请求 `webmasters.readonly`

用户在同意屏幕上取消勾选 Search Console 时，回调带 `auth_error=gsc_not_granted` 返回，而不是假装成功。

## 4. Cookie 契约

| 名称 | 内容 | Path | 生命周期 |
|---|---|---|---|
| `gg_oauth_tx` | state + PKCE verifier + 返回路径 | `/` | 10 分钟，**单次使用**（回调中无条件删除） |
| `gg_id` | 只有 Google `sub` 和 email，**无 token** | `/` | 90 天（与授权的绝对上限对齐） |
| `gg_gsc` | access token + refresh token + `grantedAt` + Google `sub` | **`/api`** | 30 天滑动，**90 天绝对上限** |
| `gg_sites` | 已授权站点列表 + 真实总数 | `/` | 与 `gg_gsc` 同步 |

七条硬约束：

- **不设 `.gengrowth.ai` 域级 cookie**。域级会话会把 SaaS 端的 XSS 影响面直接扩散到营销站，反之亦然。两站各持 origin-scoped 会话，靠 Google `sub` 关联。
- **`gg_gsc` 限定 `/api`**，token 因此不随页面请求发出，也就不可能被序列化进 RSC payload。站点列表因此拆到 `/` 作用域的 `gg_sites`——页面要渲染站点下拉，但页面请求读不到 `/api` 的 cookie。
- **`access_type=offline`**，申请 refresh token。它**只**存在于访客自己浏览器的密封 cookie 里，服务端没有任何一处保存。这是"回访不用重走同意屏幕"的唯一实现方式：access token 只活一小时。
- **30 天滑动 + 90 天绝对上限**。每次静默续期重新密封两个 cookie（滑动），但 `grantedAt` 永不重盖——被盗 cookie 每月重放一次也活不过 90 天。滑动窗口对访客不作承诺：同意屏幕处于 Testing 时 Google 7 天就会作废 refresh token，那是别人系统里的数字。
- **凭据与身份必须同人，且必须能证明**。`gg_gsc` 里带 Google `sub`，每次解析都与 `gg_id` 比对：两者都在且相同才用，否则（不一致、`gg_gsc` 没有 `sub`、或 `gg_id` 不在）一律清掉授权 cookie 并要求重新连接。`gg_id` 的生命周期正是为此对齐到 90 天绝对上限——身份不可能先于还能用的授权过期，所以"有授权、没身份"是异常，而不是"无从比对"。若跳过这一支，绑定就只在第二个账号走完整轮 OAuth 时才生效，而那一步回调本身已经处理了：共享浏览器里那份 30 天滑动的授权照用不误。回调侧同样不存不可绑定的授权：token set 里没有 `sub` 时带 `auth_error=identity_missing` 返回，而不是塞一份下一次请求就会被丢掉的 cookie。
- **账号换人时同时在 Google 侧撤销**。回调发现浏览器里那份授权属于别人，清 cookie 之外还会尽力撤销它的 refresh token（`after()`，在响应之后执行）——只清 cookie 只是"忘掉"，凭据在 Google 那边还能活几个月。撤销按 client+user 生效，因此**只**对 `sub` 不同的那份做；慢或失败都不影响这次登录。
- **断开即在 Google 侧撤销**。`POST /api/auth/google/logout` 先向 Google revoke endpoint 撤销 refresh token（撤 refresh 会连带作废由它派生的 access token；反过来不成立），再无条件清空全部 cookie。Google 没确认成功时页面**如实说没确认**，并给出 Google 账号第三方权限页的入口，而不是报告成功。

每个用途用 HKDF 派生独立子密钥，用途名参与 AEAD 的 AAD：一个 cookie 的值搬到另一个 cookie 名下会验证失败，而不是被误解成另一种凭据。复用 `TOKEN_ENCRYPTION_KEY` 作为 root 也因此安全——cookie 密钥与旧的 token 存储密钥是不同的派生密钥。

root key 在两个授权路由入口处**预先校验**（`assertCookieSecretConfigured()`）。Node 的 base64 和 hex 解码都是宽容的：粘错的值不会报错，而是产生一把**不同的**密钥，症状是"所有访客都莫名退出"，几周后才被发现且不可恢复。把 64 位 hex 的 `TOKEN_ENCRYPTION_KEY` 粘进 base64 的 `MARKETING_COOKIE_SECRET` 是最容易犯的那次——现在会直接报错并点名是哪个变量。

读路径不抛（`cookieSecretFailure()`）：页面渲染和工具接口把"密钥建不出来"降级成"这位访客没连接"，访客看到的是连接入口而不是 500——否则挂掉的正是带着断开按钮的那几个工具页。**降级只对访客不可见，对日志必须可见**：每个降级点都会打一条点名环境变量的 `console.error`，配置故障不可以看起来像"这位访客本来就没 cookie"。此时不清任何 cookie：密钥修好后那些 cookie 还能打开，删了反而把可修复的环境变量变成一份撤不掉的 refresh token。

## 5. 上线清单

- [ ] Console 确认同意屏幕状态（决定第 3 节走哪一步）
- [ ] Vercel 确认 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` / `TOKEN_ENCRYPTION_KEY` 仍在当前项目的生产环境（Root Directory 已切到 `apps/marketing`，变量应随项目保留，但值得核一眼）
- [ ] **核对 cookie root key 的格式，不只是"存在"**：`TOKEN_ENCRYPTION_KEY` 必须是偶数位 hex，`MARKETING_COOKIE_SECRET`（若设置）必须是能往返解码的 base64、≥32 字节。以前粘错值只会静默产生一把不同的密钥；现在授权路由会直接 503 并在服务端日志里点名是哪个变量，**登录会当场失败而不是几周后才发现**。部署后走一次登录即可确认
- [ ] 设 `MARKETING_GSC_CONNECT_ENABLED=true`
- [ ] 走一遍：登录 → 授权 → 工具页出现站点下拉 → 运行诊断
- [ ] 关掉标签页、隔一小时再进：**不应**再看到同意屏幕（这是 offline 授权唯一的可见验收点；看到了说明 refresh token 没拿到或没存住）
- [ ] 工具页点"断开 Search Console"：页面回到连接态，且 Google 账号 → 第三方访问权限里 GenGrowth 已消失
- [ ] 撤销授权（Google 账号 → 第三方访问权限）后，工具页回到"连接 Search Console"态
- [ ] 换一个 Google 账号在同一浏览器登录：上一个账号的授权应被清掉，而不是被新身份继续使用

---

# 附：Google 敏感范围验证（2026-07-31 起进行中）

## 当前状态

> ⚠️ **2026-08-07 实查 Cloud Console 后更正，本节此前的两条前提都不成立。** 原文说发布状态是「测试」、`webmasters.readonly` 属敏感范围——控制台里两条都不是这样。核实回执见 `gengrowth-ops/inbox-maboyang/00-inbox/2026-08-07-p0工具-QA-QB-QC确认结果.md`。

GenGrowth 项目（335450701160）的同意屏幕**发布状态 = 正式版**，用户类型 = 外部，已授权用户 2 名。

`webmasters.readonly` 在本项目的「数据访问」页列在**非敏感范围**下；列在敏感范围（需要批准）下的是 `analytics.readonly`，而公开工具的授权流并不请求它——实测授权跳转的 scope 只有 `openid email profile webmasters.readonly`。

由此有三条推论，都和本节原来的说法相反：

- **不存在「只有测试用户能授权」的限制**，任何 Google 账号都能完成授权。
- **「此应用未经 Google 验证」警告页当前不应出现。** 控制台原文：「如果您的用户看到"未经验证的应用"屏幕，这是因为您的 OAuth 请求包括其他未批准的范围。」我们的请求不含任何敏感或受限范围。
- **100 人用户上限同样不适用**（该上限只在请求未批准的敏感/受限范围时生效）。

因此 `MARKETING_GSC_INVITE_ONLY` 的内测态不再是被 Google 逼出来的，而纯粹是我方的放量节奏选择——要不要开由受控测试的进度决定，不必等验证。

**仍建议提交验证**（验证中心显示品牌与数据访问尚未验证），但它不是种子招募的前置门槛。

> 一处诚实的保留：我用已授权过的账号实测，停在「选择账号」页即止，测不出全新用户的首屏。**建议找一个从未授权过的 Google 账号人工走一遍**做最终确认。

## 先有鸡还是先有蛋

提交验证需要一段演示视频，展示 OAuth 流程和这个范围的实际用途；但要录视频，功能得先能跑。

原来的解法是「利用测试模式，用测试用户账号录」。**按上面更正后的状态，这个两难本身已经不存在**：应用已是正式版，任何账号都能授权，直接上线后用 `xdawayer@gmail.com` 走通全流程录屏即可。

> 演示视频与 scope 用途说明只服务于 `analytics.readonly` 那档敏感范围的批准。当前工具授权流不请求它，所以这两项**不卡种子招募**。控制台在「数据访问」页也提醒：应用已公开时不要把未验证的范围推到生产流量，录制新范围要用预演环境或单独的测试项目。

## 提交清单

1. **应用信息**（同意屏幕 → 品牌塑造）
   - 应用名称、支持邮箱、开发者联系邮箱
   - 应用首页：`https://gengrowth.ai`
   - 隐私政策：`https://gengrowth.ai/privacy`
   - 服务条款：`https://gengrowth.ai/terms`
   - 应用徽标（上传徽标会触发品牌验证，会拉长周期；不需要的话可以先不传）
2. **网域所有权**：Search Console 里验证 `gengrowth.ai`（同一个 Google 账号下）
3. **敏感范围用途说明**——审核最看重这段。要写清楚四件事：
   - 读什么：`webmasters.readonly`，只读该用户自己已验证站点的 Search Analytics 日级点击/曝光
   - 用来干什么：生成一份流量变化诊断报告，直接返回给该用户本人
   - 凭据放哪里：申请 `access_type=offline`。access token 和 refresh token 都用 AES-256-GCM 密封在**该用户自己浏览器的 HttpOnly cookie** 里（`/api` 作用域），服务端不落库、不进 KV、不写日志。30 天滑动、90 天绝对上限，用户在工具页点"断开"即向 Google revoke endpoint 撤销。
   - 不做什么：不写入用户的站点、不在服务端存储、不与第三方共享、不用于广告或画像

   > 这段的每一句都要与代码一致。上一版写的是"`access_type=online` 连 refresh token 都不申请"——那在改成 offline 之后就是假话，而**向审核方交一句假话的成本远高于多解释一句 refresh token 存在哪里**。真正需要说服审核的点不是"我们不拿长期凭据"，而是"长期凭据从不离开用户自己的浏览器"。
4. **演示视频**（YouTube，可设为不公开但不能私密）需拍到：
   - 从 `gengrowth.ai/tools/traffic-drop-diagnosis` 进入
   - 点授权 → Google 同意屏幕，**画面里要能看清所请求的范围**
   - 授权后回到工具页 → 选择站点 → 生成报告
   - 全程用测试账号，且要展示应用名与 OAuth client 一致

## 放量时

第 1 步「发布应用」**已经做过了**（发布状态已是正式版）。剩下的是我方的开关：

1. Vercel 加 `MARKETING_GSC_INVITE_ONLY=false`（或删掉这个变量再重新加值 `false`）
2. Redeploy 一次让变量生效
3. 工具页会自动从内测态换成正常的「连接 Search Console」按钮

放量的实际前置条件不是 Google 验证，而是**每个工具经 5–10 名目标 ICP 受控测试且无阻断性问题**（上司 2026-08-06 决策 4）。

> 同意屏幕里的「测试用户」列表对正式版应用不再起门禁作用，加 Gmail 不会改变谁能授权。
