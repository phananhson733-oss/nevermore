# `/new-project` 与 GenGrowth Artifact 壳层收敛复核（2026-07-30）

## 结论

生产基线中的 `/new-project` 曾被实现为脱离项目工作台的 720px 居中表单，
与仓库明确指定的 GenGrowth 四模块 Artifact 形成了第二套 authenticated UI
基线。本轮将零项目入口与真实项目页收敛到同一个 `AppShell`、同一份四模块
导航模型和同一组响应式样式；新建产品表单的真实 POST、错误映射和成功后的
`/p/{projectId}/context` 跳转均未改变。

本轮没有把批准 Artifact 中的 RelayOps 场景数据、数字或 mock 状态复制进
生产应用，也没有修改 API、数据库 schema、认证、数据源连接、发布或外部写
边界。

## 双代理审查

- ChatGPT Pro 对话：
  [项目视觉与功能调整](https://chatgpt.com/c/6a6afeeb-dc84-83e8-b4ae-0c7ab71f9e5f)
- 提交给 Pro 的源码基线：
  `d32c8d24fd1f2241402ca734775d9dbc1c2901ee`
- 安全源码包：
  `nevermore-new-project-artifact-convergence.zip`
- 包内容：53 个任务相关普通文件；排除 `.git`、`node_modules`、构建产物、
  缓存、`.env`、数据库、运行状态、浏览器状态和凭据
- ZIP 字节数：`441593`
- ZIP SHA-256：
  `b4f3049b8675fb813c2c4d0959968eb3770f985634db01c125fa17b46e0e7f76`
- 仓库密钥扫描与包内二次扫描：通过

Pro 返回的候选补丁：

- 18 个文件，1,330 行 unified diff
- 字节数：`44875`
- SHA-256：
  `25a0d6c29d5d4c287188de3a7470e1c9142621fd4ebc104cfa446225e6317ae8`
- 验证记录字节数：`5810`
- 验证记录 SHA-256：
  `a5d7e19342788a585398ac0a5380e7ee1aca17380ebb027a22224f56ed031df9`

Codex 在独立 detached worktree 中对该补丁执行了 `git apply --check`、
实际应用和 `git diff --check`，均通过。候选补丁没有直接覆盖主工作树，而是
逐文件独立复核后吸收了四项有效约束：

- README 必须把共享导航模型，而不是旧 route-local helper，标记为四模块
  权威来源；
- `AppShell` 使用 discriminated state，零项目状态不能注入虚构的项目计划
  或进度；
- 四个不可用模块使用原生 `disabled`，由可聚焦导航容器统一说明锁定原因；
- 独立 E2E 同时固定 payload trimming、空业务背景 omission、`/context`
  跳转和移动端横向导航。

本地实现保留了已通过完整仓库门禁的组件边界、Artifact token 和文案，其余
Pro 候选代码没有盲目套用。

Pro 正确地把其附件环境中的根 lint、完整 typecheck、Vitest、Playwright 和
production build 标记为“未验证”；这些门禁由 Codex 在完整仓库中独立执行。

## 实际修改

1. 新增共享异步 Server Component `AppShell`，唯一拥有 sidebar、topbar、
   账户区、语言切换、工具区、响应式布局和主内容容器。
2. `/p/[projectId]/*` 继续读取并注入真实 `ProjectSwitcher`、项目导航、
   badge、90 天计划进度和项目阶段；没有伪造项目数据。
3. `/new-project` 使用同一壳层的零项目状态：
   - 四模块名称准确可见；
   - 没有项目时不可导航，也没有伪造 href、badge 或项目数字；
   - 主内容只保留 Product URL 和可选业务背景；
   - 中文为默认客户界面。
4. 原 route-local shell/nav CSS 移到共享目录，旧独立页面几何被移除。
5. 四模块 descriptor、route、label key 与图标由共享导航模型统一维护；
   旧 `_nav-model.ts` 仅作兼容 re-export。
6. 新增 `/new-project` 桌面与移动端回归测试；更新移动工作台语义门禁和
   文档一致性验证。
7. 全局浅色、深色 token 与批准 Artifact 的暖纸色、深绿和 lime 体系收敛，
   中文展示字体改用适合阅读的 CJK serif 栈。

## 独立验收

在完整仓库和仓库要求的 Node/pnpm 环境中，Codex 已执行：

| 门禁 | 结果 |
| --- | --- |
| Root lint | 通过 |
| Root typecheck | 通过 |
| Production build | 通过 |
| Vitest unit | 481 files、5,935 tests 通过 |
| Targeted unit | 34 tests 通过 |
| Focused shared-shell mock E2E | 30 tests 通过 |
| Full mock E2E | 183 tests 通过 |
| Full real E2E | 全新 PostgreSQL 16，44/44 tests 通过 |
| Artifact deterministic regeneration | 通过、无 diff |
| Artifact action/form verifier | 4 routes、56 actions、14 forms 通过 |
| Artifact Playwright E2E | 20 tests 通过 |
| `verify:spec` | 通过 |
| `verify:spec:test` | 50 tests 通过 |
| `implementation:check` | 通过 |
| Restore drill | 38 tests 通过，覆盖率超过门槛 |
| Contract/OpenAPI checks | 通过 |
| Secrets scan/redaction | 扫描通过，75 tests 通过 |
| `pnpm audit --audit-level moderate` | 0 vulnerabilities |
| Deploy config check | 通过 |
| `git diff --check` | 通过 |

真实 E2E 还验证了两类异步交付物均由实际 worker 和 pg-boss 完成，而非在
浏览器中伪造完成态：

- `service_bundle`：33,139 bytes，SHA-256
  `5681d56be9825dc3517e5f19274363e3edb6042e4d41178ee3ed75fe42a04e08`；
- `client_bundle`：11,547 bytes，SHA-256
  `6cdb72b9b84b55f8635d5372e2536d97ae25cfda18d6a04830c297f31a9873d7`；
- 两个 canonical run、bundle 和 pg-boss job 的标识均一一对应，终态均为
  `completed`，队列重试次数均为 0；
- 一次性数据库执行 34 个迁移，第二次执行为 0，并通过 78 张表、17 个
  authority hash、105 个索引、148 个触发器和 67 个例程的契约检查；
- 一次性数据库容器、端口和 blob 目录均已清理，既有测量数据库未被触碰。

桌面与移动端浏览器检查还确认：

- 1440px 和 390px 根页面均无水平溢出；
- `html[lang]` 为 `zh-CN`；
- sidebar/topbar 与四模块均存在；
- 零项目模块具有明确的 disabled 语义和不可用原因；
- 页面没有 RelayOps 或 SignalFrame 客户文案；
- Product URL 表单仍走真实创建路径。

视觉证据保存在：

```text
/Users/wzb/.gstack/projects/xdawayer-nevermore/designs/
  design-audit-20260730-new-project/screenshots/new-project-final-desktop-updated.png
/Users/wzb/.gstack/projects/xdawayer-nevermore/designs/
  design-audit-20260730-new-project/screenshots/new-project-final-mobile-updated.png
```

## 审查中的保留风险

- `/new-project` 同时可能被零项目用户和已有项目用户用于添加产品。当前页面
  诚实表示“正在添加产品”，但不会构造虚假项目 switcher；已有项目用户仍可
  使用浏览器历史返回。若未来要求在该页直接切回其他项目，应读取真实项目列表
  后注入真实 `ProjectSwitcher`，不能用 mock option 代替。
- 本报告中的 mock E2E、静态 Artifact E2E 与本地浏览器截图不是 hosted
  GSC、GA4、DataForSEO 或真实客户数据验证。
- 发布、远程 CI、生产域名和构建 SHA 需要在合并部署后另行核验；本报告不把
  本地通过写成线上通过。
