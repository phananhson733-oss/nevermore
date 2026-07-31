# 营销站 Google 登录 + Search Console 授权配置

面向 gengrowth.ai（`apps/marketing`）。代码已就绪且默认关闭。

产品版本 0.3.0 · 最后更新 2026-07-31

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
| 授权类型 | `access_type=offline` + refresh token | `access_type=online`，无长期凭据 |
| CSRF | 明文 cookie 存 state | 密封 cookie 存 state + **PKCE S256** |

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
| `gg_id` | 只有 Google `sub` 和 email，**无 token** | `/` | 30 天 |
| `gg_gsc` | access token + 已授权站点列表 | **`/api`** | 随 token 过期（约 1 小时） |

三条硬约束：

- **不设 `.gengrowth.ai` 域级 cookie**。域级会话会把 SaaS 端的 XSS 影响面直接扩散到营销站，反之亦然。两站各持 origin-scoped 会话，靠 Google `sub` 关联。
- **`gg_gsc` 限定 `/api`**，token 因此不随页面请求发出，也就不可能被序列化进 RSC payload。
- **`access_type=online`**，不申请 refresh token —— 没有长期凭据需要保管或泄漏。

每个用途用 HKDF 派生独立子密钥，用途名参与 AEAD 的 AAD：一个 cookie 的值搬到另一个 cookie 名下会验证失败，而不是被误解成另一种凭据。复用 `TOKEN_ENCRYPTION_KEY` 作为 root 也因此安全——cookie 密钥与旧的 token 存储密钥是不同的派生密钥。

## 5. 上线清单

- [ ] Console 确认同意屏幕状态（决定第 3 节走哪一步）
- [ ] Vercel 确认 `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` / `GOOGLE_REDIRECT_URI` / `TOKEN_ENCRYPTION_KEY` 仍在当前项目的生产环境（Root Directory 已切到 `apps/marketing`，变量应随项目保留，但值得核一眼）
- [ ] 设 `MARKETING_GSC_CONNECT_ENABLED=true`
- [ ] 走一遍：登录 → 授权 → 工具页出现站点下拉 → 运行诊断
- [ ] 撤销授权（Google 账号 → 第三方访问权限）后，工具页回到"连接 Search Console"态

---

# 附：Google 敏感范围验证（2026-07-31 起进行中）

## 当前状态

GenGrowth 项目（335450701160）的同意屏幕**发布状态 = 测试**，用户类型 = 外部，测试用户 2/100。

这意味着：**只有测试用户列表里的账号能完成授权**，其他账号会被 Google 直接拦下（提示应用未通过验证），无法绕过。

工具页因此默认走**内测态**：`MARKETING_GSC_INVITE_ONLY` 只要不显式设为 `"false"` 就视为内测中，页面先说明限制、再给一个次要的授权入口。受邀者多点一下就能进，非受邀者在被 Google 拦住之前就已经知道原因。

**不要**在验证通过前点「发布应用」。推到生产模式后应用对所有人开放，但因为带敏感范围且未验证，访客会看到「此应用未经 Google 验证」的警告页，还要点「高级 → 继续（不安全）」才能过——对获客工具来说，这比"内测中"伤得多，而且未验证应用的授权用户数仍有上限。

## 先有鸡还是先有蛋

提交验证需要一段演示视频，展示 OAuth 流程和这个范围的实际用途；但要录视频，功能得先能跑。

解法是利用测试模式：**用测试用户账号录**。所以顺序是先上线（内测态）→ 用 `xdawayer@gmail.com` 走通全流程录屏 → 再提交。

## 提交清单

1. **应用信息**（同意屏幕 → 品牌塑造）
   - 应用名称、支持邮箱、开发者联系邮箱
   - 应用首页：`https://gengrowth.ai`
   - 隐私政策：`https://gengrowth.ai/privacy`
   - 服务条款：`https://gengrowth.ai/terms`
   - 应用徽标（上传徽标会触发品牌验证，会拉长周期；不需要的话可以先不传）
2. **网域所有权**：Search Console 里验证 `gengrowth.ai`（同一个 Google 账号下）
3. **敏感范围用途说明**——审核最看重这段。要写清楚三件事：
   - 读什么：`webmasters.readonly`，只读该用户自己已验证站点的 Search Analytics 日级点击/曝光
   - 用来干什么：生成一份流量变化诊断报告，直接返回给该用户本人
   - 不做什么：不写入、不存储在服务端、不与第三方共享、不用于广告或画像
     （这几条是实话：报告即算即出，token 只存在于 `/api` 作用域的加密 cookie 里，`access_type=online` 连 refresh token 都不申请）
4. **演示视频**（YouTube，可设为不公开但不能私密）需拍到：
   - 从 `gengrowth.ai/tools/traffic-drop-diagnosis` 进入
   - 点授权 → Google 同意屏幕，**画面里要能看清所请求的范围**
   - 授权后回到工具页 → 选择站点 → 生成报告
   - 全程用测试账号，且要展示应用名与 OAuth client 一致

## 过审之后

1. 同意屏幕 → 受众 → **发布应用**
2. Vercel 加 `MARKETING_GSC_INVITE_ONLY=false`（或删掉这个变量再重新加值 `false`）
3. Redeploy 一次让变量生效
4. 工具页会自动从内测态换成正常的「连接 Search Console」按钮

在此期间想扩大内测，直接在同意屏幕的测试用户里加 Gmail 即可，上限 100，加完立即生效，不需要重新部署。
