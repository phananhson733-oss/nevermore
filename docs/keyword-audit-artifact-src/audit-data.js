(function defineNevermoreKeywordAudit(global) {
  "use strict";

  function deepFreeze(value) {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) {
      return value;
    }

    Object.values(value).forEach(deepFreeze);
    return Object.freeze(value);
  }

  const audit = {
    version: "1.0.0",
    reviewedAt: "2026-07-27",
    title: "关键词库与 SEO/GEO 能力需求审计",
    subtitle: "正式产品方案 · 13 条需求的审核、改写、影响范围与落地证据",
    scopeNotice:
      "本审计以 Nevermore 的当前 canonical 能力为起点，采用方案 2：扩展统一产品模型，不建立平行 SEO 工具。",
    productionNotice:
      "审核通过不等于已上线。代码、数据、Contract、测试和真实 Provider 证据全部完成之前，目标状态不视为生产能力。",
    source: {
      title: "GenGrowth 工具优化需求",
      date: "2026-07-23",
      scope: "关键词库、增长地图、执行中心、概览与 SEO/GEO 核心能力",
    },
    customerVisibleConnectors: ["GSC", "GA4", "GitHub"],
    summary: {
      requirementCount: 13,
      adoptCount: 4,
      rewriteCount: 8,
      deferCount: 1,
      recommendation: "采用方案 2：扩展 Nevermore 的 canonical 产品模型",
      customerFlow:
        "URL / 产品画像 → 页面、关键词、竞品与技术证据 → 统一增长机会 → 执行交付物 → 发布或变更回执 → 效果追踪",
      governanceGate:
        "关键词发现、导入与 AI 候选生成可以先发生；映射页面、创建内容或进入执行前，必须完成 Topic Model 与页面归属审核。",
    },
    decisionLabels: {
      adopt: "直接纳入",
      rewrite: "改写后纳入",
      defer: "后置",
    },
    truthLabels: {
      current: "当前已存在",
      partial: "部分存在",
      "not-implemented": "尚未实现",
      "external-dependent": "依赖外部接入",
    },
    requirements: [
      {
        id: 1,
        title: "Topic Map 与执行前治理门槛",
        sourcePriority: "P1",
        auditedPriority: "P1",
        sourceLocation: "增长地图 · Topic Map",
        sourceStatement:
          "增加可交互话题地图，作为关键词入库前的强制 Step 0；节点可增删改、查看关键词与内容空白，确认后供 Cluster 选择并提示覆盖冲突。",
        currentTruth: "partial",
        currentEvidence: [
          "关键词已经拥有稳定身份、Cluster 标签、页面映射、审核状态与并发 Revision。",
          "当前 Topic Cluster 只是基于 Cluster 标签和页面归属形成的读取投影，还不是可编辑、可确认、可版本化的 Topic Model。",
          "尚无稳定 Topic Node Identity、不可变确认版本、历史别名和 Split/Merge 后继关系。",
        ],
        targetTruth:
          "由系统先生成 Draft Topic Model，客户确认后成为关键词进入执行和页面归属决策的正式治理依据。",
        decision: "rewrite",
        rationale:
          "空白人工地图作为导入硬门禁会阻断已有数据与 AI 发现，也容易形成第二套 Cluster 真相。应把确认门槛放在执行前，并让 Topic Identity 与现有关键词治理共用同一 authority。",
        rewrittenAcceptance: [
          "URL 抓取、关键词导入、GSC/Provider 入库与 AI 候选生成不被 Topic Map 阻断。",
          "系统依据产品画像、页面、种子词、竞品和一方数据生成可编辑 Draft；Draft 节点支持新建、改名、移动、删除和内容空白检查。",
          "Confirmed Revision 不可原地修改；后续调整创建新 Revision，并保留旧名称 Alias 与历史引用。",
          "关键词进入执行、映射已有页面或创建新内容前，必须引用已确认的 Topic Node 与 Topic Revision。",
          "覆盖冲突必须展示冲突依据并要求显式决策，不能静默通过。",
        ],
        modules: ["growth-map", "execution"],
        stage: ["stage-1", "stage-2"],
        stageParts: [
          {
            stage: "stage-1",
            deliverable:
              "稳定 Topic Identity、Revision、Keyword Review Decision 与兼容投影。",
          },
          {
            stage: "stage-2",
            deliverable:
              "完整可交互 Topic Map、覆盖状态、历史版本与结构化冲突处理。",
          },
        ],
        dependencies: [
          "稳定 Topic Identity 与不可变 Topic Model Revision",
          "Append-only Keyword Review Decision 与 Expected Revision",
          "历史 Cluster Alias 回填和双读一致性验证",
          "产品画像、页面清单、关键词来源与竞品证据",
        ],
        completionEvidence: [
          "数据迁移与 Repository 测试证明 Confirmed Revision 不可原地修改，旧 Alias 仍可解析。",
          "OpenAPI、Service 与真实 Mutation 支持 Draft、Confirm、Revise 和 Keyword Assignment。",
          "刷新页面后节点与关键词归属仍存在，并发使用旧 Revision 会 fail closed。",
          "E2E 覆盖生成 Draft、人工编辑、确认、冲突决策和执行前门槛。",
        ],
        notIncluded: [
          "不把 Topic Map 设为关键词发现或导入前的空白硬门禁。",
          "不创建与现有 Cluster/Page Assignment 并行的第二套可写真相。",
          "不使用前端本地状态保存正式 Topic 决策。",
        ],
      },
      {
        id: 2,
        title: "同意图词的重复与蚕食治理",
        sourcePriority: "P0",
        auditedPriority: "P0",
        sourceLocation: "增长地图 · 关键词库",
        sourceStatement:
          "当两个关键词指向同一页面且搜索意图相同时标记“可能重复”，允许合并并把其中一个折叠隐藏，但不删除数据。",
        currentTruth: "partial",
        currentEvidence: [
          "关键词稳定身份、来源记录、Intent、Cluster 与页面映射已经存在。",
          "同一页面承接多个词目前是合法状态，但没有 Keyword Relation Candidate 或人工关系决策账本。",
          "仅凭“同页面 + 同意图”不足以区分正常主词/支持词与真正的重复或蚕食风险。",
        ],
        targetTruth:
          "系统生成有解释依据的重复/蚕食候选，客户决定 Primary、Supporting、Keep Separate、Park 或 Needs Research。",
        decision: "rewrite",
        rationale:
          "相同页面和意图只是候选信号，不能作为自动合并依据。B2B 内容通常需要一个主词承接多个语义变体，错误折叠会损害覆盖与可追溯性。",
        rewrittenAcceptance: [
          "候选关系综合 Topic、Intent、Mapped Page、SERP overlap 与词面相似度，并展示 Rule Version、证据和新鲜度。",
          "人工决策至少支持 Primary/Supporting、Keep Separate、Park Secondary 与 Needs Research。",
          "系统不删除 Keyword Entity 或来源记录，也不不可逆合并稳定身份。",
          "Supporting Keyword 可在默认列表折叠，但搜索、Brief、Artifact 和 Results 仍可追溯。",
          "候选依据发生实质变化时旧决定保留，新 Candidate 进入审核。",
        ],
        modules: ["growth-map", "execution", "results"],
        stage: ["stage-1"],
        dependencies: [
          "Keyword Relation Candidate 与 Decision 数据模型",
          "稳定 Topic/Intent/Page Mapping 信号",
          "可选 SERP overlap Observation 与信号新鲜度",
          "Expected Revision、Reviewer 与 Reason 审计字段",
        ],
        completionEvidence: [
          "Repository 测试证明 unordered pair/group 去重且所有原始词与来源不被删除。",
          "Contract 与 Mutation 返回候选依据、决策 Revision 和审计信息。",
          "增长地图支持反复切换候选、做出每种决策并在刷新后恢复。",
          "Integration/E2E 证明 Supporting Keyword 在执行和效果追踪中仍可追溯。",
        ],
        notIncluded: [
          "不依据单一规则自动删除、自动合并或静默隐藏关键词。",
          "不把列表折叠状态当作数据删除。",
          "不承诺在缺少 SERP 数据时具有同等置信度。",
        ],
      },
      {
        id: 3,
        title: "Interview Summary 与 User Review 来源",
        sourcePriority: "P2",
        auditedPriority: "P2",
        sourceLocation: "增长地图 · 关键词来源",
        sourceStatement:
          "把社区/VOC 拆为访谈摘要与用户评价，并在数据连接中增加 App Store、G2、Capterra 等接入入口。",
        currentTruth: "partial",
        currentEvidence: [
          "关键词来源已支持 CSV、排名 Provider、GSC 和受治理的手工录入，并保留来源指针与采集时间。",
          "Interview Summary 与 User Review 尚未成为独立的正式来源类型。",
          "外部评论平台的授权、使用条款、采集频率、PII 与保留策略尚未形成可上线证据。",
        ],
        targetTruth:
          "把访谈摘要与用户评价作为不同的受治理来源；先支持手工/CSV，再按授权增加外部 Provider adapter。",
        decision: "rewrite",
        rationale:
          "两类 VOC 的证据性质确实不同，但 Provider 名称不等于客户已连接。直接增加连接卡会制造错误授权预期，并带来许可和隐私风险。",
        rewrittenAcceptance: [
          "正式来源 Taxonomy 增加 interview_summary 与 user_review，并保留 Provider、Source Pointer、Captured At、Data As Of、Scope 与许可信息。",
          "第一步支持受治理的手工/CSV 导入，并在关键词详情中显示真实来源与局限。",
          "外部平台接入前必须完成授权、使用条款、PII、最小存储与保留策略审查。",
          "用户评价产生的关键词仍进入统一 Keyword Entity 与 Source lineage，不建立平行词库。",
          "客户可见数据连接继续只显示 GSC、GA4 和 GitHub。",
        ],
        modules: ["growth-map", "execution"],
        stage: ["stage-3"],
        dependencies: [
          "Keyword Source Taxonomy 与受治理导入契约",
          "来源许可、可见性、PII 与保留策略",
          "Provider-specific adapter 审批和失败/新鲜度语义",
          "Artifact Source lineage 透传",
        ],
        completionEvidence: [
          "Migration/Repository 测试证明两类来源分离且仍汇入同一稳定关键词身份。",
          "手工/CSV 导入拥有 Scope、Idempotency、Pointer 与内容许可校验。",
          "UI 对来源、Provider、新鲜度和不可用原因诚实呈现。",
          "只有具备真实授权和采集证据的 Provider 才通过集成与 E2E 验收。",
        ],
        notIncluded: [
          "不把 App Store、G2、Capterra 或内部 Provider 显示为虚假的客户连接卡。",
          "不在未批准授权与使用条款时自动抓取评论。",
          "不把访谈摘要和公开用户评价混成同一种证据。",
        ],
      },
      {
        id: 4,
        title: "Artifact 参考来源与证据侧栏",
        sourcePriority: "P2",
        auditedPriority: "P0",
        sourceLocation: "执行中心 · 交付物详情",
        sourceStatement:
          "在交付物详情增加参考来源区块，展示关键词建卡时填写并自动带入的竞品 URL 和数据来源。",
        currentTruth: "partial",
        currentEvidence: [
          "Content Shadow 类型交付物已经拥有 Research Pack、Research Sources、QA 与 Revision History。",
          "Technical、Metadata、Code Patch、Publish/UTM 等 Artifact 尚无统一 Source Ref 投影。",
          "当前没有理由让用户在每个关键词卡片重复维护一份参考 URL 权威数据。",
        ],
        targetTruth:
          "所有 Artifact 类型通过统一只读 Source Sidecar 展示从 Evidence、Finding、Research Pack 或 Receipt 透传的来源与限制。",
        decision: "adopt",
        rationale:
          "参考来源直接影响客户对交付物的信任和审核效率，应进入第一阶段；但来源 authority 必须来自已有证据链，而不是重复手填 URL。",
        rewrittenAcceptance: [
          "统一 Artifact Source Ref 至少提供 Kind、Title/URL、Authority Tier、Captured At/Data As Of、Pointer、Freshness、Availability 与 Limitation。",
          "Content Artifact 从 Research Pack 适配，Technical/Metadata 从 Finding、Evidence 或 Page Snapshot 适配，Publish/UTM 从 Approved Revision、Publication Plan 与 Measurement Plan 适配。",
          "来源不可披露时显示结构化不可用原因，不泄露正文、凭据或内部 URL。",
          "来源区块支持打开合法外部来源或对应证据详情，不能用通用 Toast 代替目的地。",
        ],
        modules: ["execution"],
        stage: ["stage-1"],
        dependencies: [
          "Artifact-level Source Ref Contract",
          "Research Pack、Evidence、Finding 与 Receipt lineage",
          "按 Artifact Type 的 adapter",
          "Customer Visibility 与访问控制策略",
        ],
        completionEvidence: [
          "每一种在售 Artifact Type 都有来源 adapter 或结构化 unavailable 状态。",
          "Contract/Service 测试验证时间、Pointer、Freshness、Limitation 与可见性。",
          "执行中心 UI 在交付物主体旁展示来源、QA、Revision 与 Approval。",
          "E2E 验证合法跳转、不可披露状态及刷新后来源一致性。",
        ],
        notIncluded: [
          "不要求用户在 Keyword Card 重复维护参考 URL。",
          "不把临时输入的 URL 自动提升为权威来源。",
          "不复制完整来源正文或泄露不可披露内容。",
        ],
      },
      {
        id: 5,
        title: "阻断原因与解锁条件",
        sourcePriority: "P0",
        auditedPriority: "P0",
        sourceLocation: "执行中心 · 任务列表",
        sourceStatement:
          "被阻断任务在列表中直接显示阻断原因与解锁条件，例如竞品数据过期后需重新采集。",
        currentTruth: "partial",
        currentEvidence: [
          "部分内容交付流程已经能表达 Claim、Provider Readiness 或研究证据不足等阻断语义。",
          "通用 Action/Artifact 列表尚无统一 Blocker、Owner、Unblock Condition、Observed At 与 Freshness 投影。",
          "阻断是否解决目前不能在所有交付物类型中由 canonical 状态一致判断。",
        ],
        targetTruth:
          "执行队列直接显示真实 Blocker 摘要、负责人、解锁条件、下一步与证据新鲜度，并在解决后停止展示。",
        decision: "adopt",
        rationale:
          "这是客户理解任务为什么停滞和如何继续的基础透明度，已有局部模式可提炼为通用产品能力。",
        rewrittenAcceptance: [
          "Action Blocker 包含 Code、Summary、Unblock Condition、Owner、Source、Observed At、Freshness 与 Active/Resolved 状态。",
          "阻断可以来自 Evidence/Claim、Provider Readiness、Approval、Dependency 或 Async Failure，但必须保留原始指针。",
          "任务列表不进入详情即可看到阻断摘要和解锁动作；点击后进入真实证据或操作入口。",
          "阻断条件满足后旧 Blocker 变为 Resolved，列表不继续展示过期提示。",
        ],
        modules: ["execution"],
        stage: ["stage-1"],
        dependencies: [
          "通用 Action Blocker 读模型",
          "不同 Artifact/Action 类型的 blocker adapter",
          "Owner 与 source evidence pointer",
          "Active/Resolved 生命周期和新鲜度规则",
        ],
        completionEvidence: [
          "数据与 Domain 测试验证 Blocker 的激活、解决、去重和历史保留。",
          "Service/Contract 输出阻断原因、条件、负责人、下一步和新鲜度。",
          "执行队列在不打开详情时即可读取关键阻断信息。",
          "E2E 覆盖阻断、执行解锁动作、刷新和已解决提示消失。",
        ],
        notIncluded: [
          "不由前端根据任务标题猜测阻断原因。",
          "不把固定“超过 90 天”等示例阈值写死到所有任务。",
          "不让机器运行失败自动覆盖业务负责人决策。",
        ],
      },
      {
        id: 6,
        title: "真实业务阶段与任务进度",
        sourcePriority: "P2",
        auditedPriority: "P1",
        sourceLocation: "执行中心 · 任务列表",
        sourceStatement:
          "进行中任务显示完成步骤和进度条，例如“3/6 步已完成”。",
        currentTruth: "partial",
        currentEvidence: [
          "异步运行已经拥有机器执行进度，但它只描述一次 Run，不代表整个客户任务完成度。",
          "不同 Artifact 类型并非都拥有版本化的业务 Step Definition。",
          "执行队列尚无统一 Phase、Completed Steps、Total Steps、Next Step 与 Updated At 投影。",
        ],
        targetTruth:
          "默认展示可审计的业务阶段；仅在任务拥有版本化步骤定义时展示 completed/total 与进度条。",
        decision: "rewrite",
        rationale:
          "装饰性的百分比会制造虚假精确度。业务进度必须来自稳定步骤定义，机器 Run 只能作为其中一项输入。",
        rewrittenAcceptance: [
          "Action Progress 至少包含 Phase、State、Next Step 与 Updated At。",
          "只有绑定 Versioned Step Definition 的任务才能显示 Completed Steps、Total Steps 和百分比。",
          "没有可计数步骤时显示“研究中、生成中、待审核、待发布、待验证”等真实阶段。",
          "机器 Run 失败、重试或完成不会自动把整个业务 Action 标记为完成。",
        ],
        modules: ["execution"],
        stage: ["stage-1"],
        dependencies: [
          "Action Progress 统一投影",
          "按 Artifact Type 定义的 versioned business steps",
          "Run/Approval/Artifact/Publication 状态 adapter",
          "Progress Revision 与 Updated At",
        ],
        completionEvidence: [
          "Domain 测试证明没有 Step Definition 时不输出虚假 completed/total。",
          "Contract/Service 区分 machine run progress 与 business action progress。",
          "执行队列按任务类型显示阶段或真实步数，并准确展示 Next Step。",
          "E2E 覆盖重试、审核、发布与验证跨阶段变化。",
        ],
        notIncluded: [
          "不把 async run progress 直接当成客户任务完成度。",
          "不为没有正式步骤定义的任务生成伪造百分比。",
          "不由 UI 根据状态名临时计算进度。",
        ],
      },
      {
        id: 7,
        title: "机会 SLA、待决策提醒与 Snooze",
        sourcePriority: "P1",
        auditedPriority: "P1",
        sourceLocation: "概览 · 待决策机会",
        sourceStatement:
          "机会识别后超过 14 天没有执行动作时，在概览强制触发一次推进或不推进的二选一决策。",
        currentTruth: "partial",
        currentEvidence: [
          "概览已经能从 Finding、Action 与 Artifact 聚合当前优先事项。",
          "尚无 Durable Opportunity Decision Ledger、项目 SLA、Owner、Snoozed Until 和延后原因。",
          "固定 14 天二选一无法表达合理延后、证据不足、负责人变更或已有任务等真实情况。",
        ],
        targetTruth:
          "依据可配置 SLA 对无 Action、无有效 Decision、无有效 Snooze 的机会冒泡，并记录 Advance、Decline、Defer 或 Snooze。",
        decision: "rewrite",
        rationale:
          "14 天可作为默认值，但不应成为全局硬编码；提醒必须可去重、可解释、可分派且保留正式决策历史。",
        rewrittenAcceptance: [
          "项目级 Opportunity SLA 可配置，默认值可为 14 天，并展示 First Seen、Last Seen 与触发理由。",
          "Decision 至少支持 advance、decline、defer、snooze，保存 Owner、Reason、Snoozed Until 与 Related Action。",
          "已有未解决 Action 或有效 Snooze 的机会不重复冒泡；Snooze 到期后可再次出现。",
          "推进后进入现有 Execution；拒绝或延后不会删除原始 Finding 或 Opportunity 证据。",
        ],
        modules: ["overview", "growth-map", "execution"],
        stage: ["stage-2"],
        dependencies: [
          "Stable Opportunity Fingerprint 与 Decision Ledger",
          "项目 SLA Policy、Owner 与 Snooze 时间",
          "Overview 聚合与 reminder 去重",
          "Action 创建的 Scope、Idempotency 与 Revision",
        ],
        completionEvidence: [
          "Repository 测试覆盖冒泡、去重、Decline、Defer、Snooze 和到期重现。",
          "Mutation 保存正式决策并返回审计时间、负责人和新 Revision。",
          "概览卡展示触发时间窗、证据新鲜度与关联对象。",
          "E2E 覆盖推进到已有/新建任务、延后、拒绝和浏览器刷新。",
        ],
        notIncluded: [
          "不把 14 天写死为所有项目唯一阈值。",
          "不限制为缺少业务语义的“是/否”二选一。",
          "不在已有 Action 或有效 Snooze 时重复制造提醒。",
        ],
      },
      {
        id: 8,
        title: "Canonical Internal Link Graph",
        sourcePriority: "P1",
        auditedPriority: "P2",
        sourceLocation: "增长地图 · Internal Link Map",
        sourceStatement:
          "用可交互结构图展示 Hub/Spoke 页面、双向/单向/孤岛状态、入链来源与推荐，并能直接创建补内链任务。",
        currentTruth: "partial",
        currentEvidence: [
          "站点采集与技术 Finding 可以发现部分入链不足问题。",
          "尚无以 Page Snapshot/Link Observation 为依据的 canonical node/edge graph。",
          "从 Finding 或页面计数临时反推整站链接关系，无法证明边的方向、采集时间和完整性。",
        ],
        targetTruth:
          "从不可变 Link Observation 生成可追溯 Page Graph，并把修复建议通过幂等命令转成正式 Action。",
        decision: "adopt",
        rationale:
          "内链结构对 SEO 与内容集群有直接价值，但它依赖正确的 Page/Link authority，因此应在 Topic 与页面治理稳定后交付。",
        rewrittenAcceptance: [
          "Graph Node 是稳定页面身份，Edge 来自带 Snapshot Pointer、Captured At 与 Freshness 的 Link Observation。",
          "Hub/Spoke、双向、单向和孤岛状态基于真实边计算，并显示数据覆盖与缺数。",
          "点击节点展示入链、出链、Cluster 角色与有证据的建议来源页。",
          "创建修复 Action 使用 Scope、Idempotency Key 与 Expected Revision；相同未解决建议直接打开原任务。",
          "Topic Map 与 Link Map 可共享交互组件，但不能共享业务数据结构。",
        ],
        modules: ["growth-map", "execution"],
        stage: ["stage-2"],
        dependencies: [
          "稳定 Page Identity 与 Page Snapshot",
          "Canonical Link Observation/Edge authority",
          "Topic/Page Role 与 Graph coverage",
          "幂等 Action 创建命令",
        ],
        completionEvidence: [
          "Repository 测试证明节点、方向边、Snapshot 和历史重放一致。",
          "Graph API 返回覆盖率、新鲜度、缺数与分页/规模限制。",
          "Growth Map 支持键盘与指针操作、节点详情和结构化 unavailable。",
          "E2E 证明建议只创建一个正式 Action 并可进入 Execution。",
        ],
        notIncluded: [
          "不从 Finding 文案或当前计数临时拼接 Link Graph。",
          "不把 Topic Node 与 Page Node 当成同一种业务对象。",
          "不在缺少 Crawl/Link Evidence 时显示完整站点假图。",
        ],
      },
      {
        id: 9,
        title: "90 天关键词排名趋势与变更事件",
        sourcePriority: "P0",
        auditedPriority: "P0",
        sourceLocation: "增长地图 · 关键词详情；效果追踪",
        sourceStatement:
          "关键词详情显示过去 90 天排名折线并标记每次内容改动；效果追踪增加目标词排名改前/改后变化。",
        currentTruth: "partial",
        currentEvidence: [
          "关键词详情已有当前 Rank、Volume、KD、URL 等带来源与新鲜度的指标投影。",
          "来源发生记录可保留采集历史，但当前数组不是按统一 Provider、Market、Device 聚合的 Rank Series。",
          "尚无 Receipt-backed Change Event Overlay 与固定 Measurement Window 的目标词前后对比。",
        ],
        targetTruth:
          "Stage 1 交付真实原始 Rank Series；Stage 2 只用正式 Receipt 和 Measurement Window 叠加改动事件与 Results 对比。",
        decision: "adopt",
        rationale:
          "排名历史是优先级判断和效果验证的核心，但必须把“历史序列”和“动作后效果”作为两个独立完成条件，不能用当前值或来源列表反推。",
        rewrittenAcceptance: [
          "按稳定 Keyword Identity 聚合 immutable Observation，携带 Provider、Market、Language、Device、Location、Observed At/Data As Of 与 Pointer。",
          "默认展示 90 天并允许受限窗口；Missing、Partial、Stale 不补零，也不跨 Provider 混成一条线。",
          "Stage 1 在增长地图展示原始历史；没有 Receipt 时保持明确的空事件轨。",
          "Change Event 仅接受 Approved Artifact Revision、Publication Receipt、GitHub Change/PR Receipt、Verified Technical Recheck 或受审核 Manual Change Receipt。",
          "Stage 2 的 Results 对比必须锚定固定 Observation Window，并明确时间先后不等于因果。",
        ],
        modules: ["growth-map", "results"],
        stage: ["stage-1", "stage-2"],
        stageParts: [
          {
            stage: "stage-1",
            deliverable:
              "关键词详情原始 Rank Series、Provider 分面、缺数状态和 Observation Pointer。",
          },
          {
            stage: "stage-2",
            deliverable:
              "Receipt-backed Change Event、固定 Measurement Window 与 Results 目标词对比。",
          },
        ],
        dependencies: [
          "Immutable Keyword Metric Observation",
          "稳定 Keyword Identity 与 Provider/Market/Device 分面",
          "Publication/Change Receipt",
          "Immutable Measurement Window 与 Outcome Collection",
        ],
        completionFlags: [
          {
            id: "rank_history_complete",
            label: "关键词历史序列完成",
            status: "planned",
            evidenceNeeded:
              "真实 Observation、历史 API、缺数/新鲜度语义、增长地图趋势图与 Integration/E2E。",
          },
          {
            id: "receipt_backed_results_complete",
            label: "回执支持的效果验证完成",
            status: "planned",
            evidenceNeeded:
              "Publication/Change Receipt、固定 Measurement Window、Results 前后对比与无回执失败用例。",
          },
        ],
        completionEvidence: [
          "Observation 数据与 Repository 测试证明历史不可变、分面不混合、缺数不补零。",
          "History Contract/Service 支持受限窗口、Pointer、Freshness 与结构化 unavailable。",
          "增长地图显示真实 90 天序列；没有 Receipt 时不显示伪造变更点。",
          "Results Integration/E2E 证明目标词变化只锚定正式 Receipt 与固定窗口。",
          "两项 completion flag 均有独立证据后，需求 9 才能整体标记完成。",
        ],
        notIncluded: [
          "不使用 source occurrences 冒充排名时间序列。",
          "不从当前排名反推历史，也不把缺失值补成 0。",
          "不在没有 Receipt 时伪造内容改动标记或动作归因。",
        ],
      },
      {
        id: 10,
        title: "可配置的内容衰减预警",
        sourcePriority: "P1",
        auditedPriority: "P1",
        sourceLocation: "概览 · 健康度预警",
        sourceStatement:
          "每月扫描已发布页面；连续两个月排名下滑超过 5 位或月流量环比下滑超过 20% 时预警并创建内容复审任务。",
        currentTruth: "not-implemented",
        currentEvidence: [
          "当前产品能够展示页面、关键词及部分效果窗口，但没有 Content Decay Policy、Detector、Alert 生命周期和周期任务。",
          "固定排名/流量阈值没有最低样本、季节性、品牌词、缺数和页面年龄保护。",
          "尚无从真实衰减证据去重生成 Opportunity/Action 的闭环。",
        ],
        targetTruth:
          "使用项目级可配置 Policy 和不可变指标历史检测衰减，展示窗口、阈值、样本、新鲜度与限制，并生成可审计 Alert/Opportunity。",
        decision: "rewrite",
        rationale:
          "主动监控价值明确，但原始阈值会在低样本、季节性、品牌词或数据缺失时产生大量误报，必须升级为有基线和保护条件的 Policy。",
        rewrittenAcceptance: [
          "Policy 支持排名、流量或组合规则，并定义窗口、最低样本、页面年龄、品牌词、季节性、缺数与新鲜度。",
          "默认策略可以表达“两个月下降 5 位/20%”，但客户可配置且界面说明适用条件。",
          "每次检测记录 Policy Version、Observation Window、Evidence Pointer 与命中原因。",
          "同一页面/规则/窗口只生成一个未解决 Alert；客户可 Advance、Decline、Defer 或 Snooze。",
          "推进复审时创建正式 Action 并进入 Execution。",
        ],
        modules: ["overview", "growth-map", "execution", "results"],
        stage: ["stage-2"],
        dependencies: [
          "页面与关键词不可变指标历史",
          "Content Decay Policy 与 versioned detector",
          "Opportunity Decision/Snooze 与 alert 去重",
          "周期调度、Outcome/Publication 时间与数据新鲜度",
        ],
        completionEvidence: [
          "Detector 测试覆盖低样本、季节性、品牌词、缺数、陈旧数据与边界阈值。",
          "周期任务失败不覆盖上次成功证据，重复运行不重复建 Alert。",
          "概览展示窗口、阈值、样本和推荐动作，不只显示红色状态。",
          "E2E 覆盖查看证据、延后/拒绝、创建复审 Action 与进入 Execution。",
        ],
        notIncluded: [
          "不把 5 位和 20% 写死为所有客户的唯一策略。",
          "不在低样本或缺数时直接判定衰减。",
          "不把时间上的变化自动宣称为某次内容动作导致。",
        ],
      },
      {
        id: 11,
        title: "Provider-neutral Backlink 数据能力",
        sourcePriority: "P3",
        auditedPriority: "P3",
        sourceLocation: "增长地图 · Backlink Evidence",
        sourceStatement:
          "新增外链模块，接入 Ahrefs/Moz 或手工导入，展示全站外链、引用域、页面和竞品对比，并触发外链机会。",
        currentTruth: "external-dependent",
        currentEvidence: [
          "当前没有 Backlink Snapshot、Referring Domain、Page Metric 或 Competitor Comparison 的正式数据模型。",
          "Ahrefs、Moz 等 Provider 的授权、价格、速率、指标定义和历史覆盖尚未批准。",
          "没有外部数据时，客户界面不能把空值或场景数据显示成真实外链指标。",
        ],
        targetTruth:
          "先冻结 Provider-neutral Observation/Snapshot/Opportunity 契约和受治理文件导入，再单独批准第三方深度接入。",
        decision: "defer",
        rationale:
          "长期价值成立，但近期上线缺少 Provider、授权、成本与可比指标真相。提前做完整 Tab 只会制造 mock 数据和不可兑现的连接。",
        rewrittenAcceptance: [
          "Provider-neutral 模型区分 Site、Referring Domain、Target Page、Competitor 与 Metric Definition，并保留 Snapshot、Data As Of 和 Freshness。",
          "受治理文件导入必须包含列映射、Scope、Provider/来源声明、Idempotency 与错误报告。",
          "Provider adapter 需要明确授权、指标口径、成本、频率、速率限制和数据保留策略。",
          "机会只基于真实 Snapshot Comparison 生成，并显示样本、时间和 Provider 限制。",
          "没有可用数据时展示 unavailable，不显示 0 或 mock 指标。",
        ],
        modules: ["growth-map"],
        stage: ["stage-3"],
        deliveryHorizon: "后置：第三方 Provider 深度接入需单独批准",
        dependencies: [
          "Backlink Provider-neutral Contract",
          "受治理文件导入与 Schema Mapping",
          "Provider 授权、商业成本、指标定义和速率评审",
          "Competitor/Page identity 与 Snapshot lineage",
        ],
        completionEvidence: [
          "数据模型与导入测试证明 Snapshot 不可变、Scope 正确且错误可解释。",
          "Contract 能表达不同 Provider 的指标定义、缺数、Partial、Stale 与 unavailable。",
          "真实 Provider 集成必须有授权、沙箱/生产采集记录和失败恢复证据。",
          "界面只在真实数据存在时显示指标与机会。",
        ],
        notIncluded: [
          "不进入当前上线阶段的第三方 Provider 深度接入承诺。",
          "不把 Ahrefs、Moz 或其他内部 Provider 加入客户可见连接卡。",
          "不在没有真实 Snapshot 时展示活跃 Backlink Tab 或场景指标。",
        ],
      },
      {
        id: 12,
        title: "GEO Citation Observation 与结构分析",
        sourcePriority: "P2",
        auditedPriority: "P2",
        sourceLocation: "效果追踪 · GEO Citation",
        sourceStatement:
          "AI 引用从次数升级为归因：展示被引用段落、平台，并比较未被引用文章的结构差异，以解释为什么被引用。",
        currentTruth: "not-implemented",
        currentEvidence: [
          "现有客户场景能够表达 AI Citation 数量，但生产底座尚无完整 Citation Observation Writer 与回答快照。",
          "没有 Query、Platform、Answer Snapshot、Citation URL、Passage、Captured At 和采集失败状态，就无法重放引用证据。",
          "单次引用观测和文章结构差异不能证明被引用的因果原因。",
        ],
        targetEvidenceMode: "observation",
        targetTruth:
          "把每次引用保存为可重放的 Observation，并把结构差异标为分析或假设，而不是 causal attribution。",
        decision: "rewrite",
        rationale:
          "引用段落与平台证据具有学习价值，但“为什么被引用”无法由一次观测证明；产品必须区分事实 Observation 与后续 Analysis。",
        rewrittenAcceptance: [
          "Citation Observation 保存 Query、Platform、Answer Snapshot/Hash、Citation URL、Passage、Captured At、Provider Data As Of 与 Pointer。",
          "平台和 Provider 不可用时显示 unavailable/partial/stale，不保留旧值冒充当前结果。",
          "结构比较明确标记为 Analysis，并展示样本选择、时间范围、已知限制与证据引用。",
          "界面使用“观测到的引用”和“可能相关的结构特征”，不使用因果归因措辞。",
          "结果可回链到相关页面、关键词、Artifact 与真实发布/变更回执。",
        ],
        modules: ["results"],
        stage: ["stage-3"],
        dependencies: [
          "Citation Observation 与 Answer Snapshot Writer",
          "平台/Provider 授权、采集频率和保留策略",
          "页面、关键词、Artifact 与 Receipt identity",
          "结构 Analysis 方法、样本说明与 limitation",
        ],
        completionEvidence: [
          "Repository 测试证明 Observation 不可变且失败不会覆盖上次成功数据。",
          "Contract/Service 输出 Query、Platform、Passage、时间、Pointer 与可用性。",
          "Results UI 可打开证据详情并区分 Observation 与 Analysis。",
          "E2E 覆盖真实采集或结构化 unavailable，且文案不做因果夸大。",
        ],
        notIncluded: [
          "不把一次 GEO 引用观测称为因果归因。",
          "不声称某个结构特征必然导致引用。",
          "不在 Provider 不可用时保留旧计数冒充当前结果。",
        ],
      },
      {
        id: 13,
        title: "竞品内容 Snapshot Delta 与持续监控",
        sourcePriority: "P2",
        auditedPriority: "P2",
        sourceLocation: "增长地图 · 竞品库",
        sourceStatement:
          "为已批准竞品设置月度采集，发现高度重叠的新内容或一个月排名提升超过 5 位时提醒并更新机会。",
        currentTruth: "partial",
        currentEvidence: [
          "正式竞品实体已经保存稳定身份、来源、审核状态与最近观测时间。",
          "当前没有 Project Policy、单竞品 Override、周期 Collection Run、不可变 Snapshot 与 Delta。",
          "静态竞品字段不能证明“新发布”“一个月提升”或 Gap 变化。",
        ],
        targetTruth:
          "对已审核竞品按可执行 Policy 采集不可变 Snapshot，比较 Delta，并只由真实变化生成去重 Reminder/Opportunity。",
        decision: "rewrite",
        rationale:
          "动态监控价值成立，但更新频率和阈值必须受 Provider 能力、成本、数据新鲜度和项目 Policy 约束，不能把静态字段改写成历史。",
        rewrittenAcceptance: [
          "项目默认频率支持 off、weekly、monthly、quarterly、custom；custom 限制在 7–90 天。",
          "Approved Competitor 可继承项目默认或设置 Override，并显示上次成功、下次计划、Freshness 与最近失败。",
          "每次执行生成 immutable Snapshot/Collection Run；失败不覆盖上次成功结果。",
          "Delta 至少能证明新内容、关键词重叠或排名变化的前后 Snapshot 与时间窗。",
          "同一 Delta 只生成一个未解决 Reminder/Opportunity，可进入正式决策或 Execution。",
        ],
        modules: ["overview", "growth-map"],
        stage: ["stage-2", "stage-3"],
        stageParts: [
          {
            stage: "stage-2",
            deliverable:
              "监控 Policy、Schedule、Snapshot/Delta、失败状态和 Opportunity 去重。",
          },
          {
            stage: "stage-3",
            deliverable:
              "在 Provider 授权后扩展完整内容、SERP 与 GEO 竞品动态来源。",
          },
        ],
        dependencies: [
          "Approved Competitor identity 与 Project/Override Policy",
          "周期 Collection Run、immutable Snapshot 与 Delta",
          "Provider readiness、成本、速率和数据新鲜度",
          "Opportunity Decision 与 reminder 去重",
        ],
        completionEvidence: [
          "Scheduler/Repository 测试覆盖继承、Override、7–90 天边界、失败和幂等 Delta。",
          "每条提醒可回放前后 Snapshot、规则版本、时间窗和 Provider。",
          "竞品详情展示频率、上次成功、下次计划、新鲜度与 unavailable 原因。",
          "E2E 覆盖修改可执行频率、查看 Delta、推进/延后提醒和进入机会。",
        ],
        notIncluded: [
          "不从静态竞品字段推断历史变化。",
          "不在 Provider 不可用时保存一个不会执行的假计划。",
          "不让失败采集覆盖上次成功证据，也不重复生成同一提醒。",
        ],
      },
    ],
    modules: [
      {
        id: "overview",
        name: "概览",
        enName: "Overview",
        purpose: "回答今天为什么要做什么，并让长期未决机会和健康风险重新进入决策。",
        customerChange: [
          "显示由真实 SLA 触发的待决策机会。",
          "显示带窗口、样本、新鲜度和证据的内容衰减/竞品变化预警。",
          "所有推进、拒绝、延后和 Snooze 都写入正式决策。",
        ],
        requirementIds: [7, 10, 13],
      },
      {
        id: "growth-map",
        name: "增长地图",
        enName: "Growth Map",
        purpose: "统一管理页面、关键词、Topic、竞品和结构证据，不建立平行 SEO 工具。",
        customerChange: [
          "关键词可审核、映射并进入 Topic Governance。",
          "重复/蚕食候选有解释、有人工决策且不删除来源。",
          "逐步增加 Topic、Internal Link、Metric History 和 Competitor Delta。",
        ],
        requirementIds: [1, 2, 3, 7, 8, 9, 10, 11, 13],
      },
      {
        id: "execution",
        name: "执行中心",
        enName: "Execution",
        purpose: "直接交付文章、Brief、Metadata、Code Patch 和发布计划，并展示可信来源与治理状态。",
        customerChange: [
          "任务卡展示真实业务阶段、阻断原因和下一步。",
          "交付物侧栏显示受访问控制的参考来源、QA、Revision 和 Approval。",
          "从 Topic、Keyword、Internal Link 或监控机会进入同一 Action/Artifact 生命周期。",
        ],
        requirementIds: [1, 2, 3, 4, 5, 6, 7, 8, 10],
      },
      {
        id: "results",
        name: "效果追踪",
        enName: "Results",
        purpose: "把技术复查、GSC/GA4 固定窗口、关键词历史和 GEO 观测放进可重放的证据链。",
        customerChange: [
          "关键词历史与回执支持的前后对比分开验收。",
          "所有窗口、来源、新鲜度、缺数和归因边界可见。",
          "GEO 展示 Citation Observation，不制造因果结论。",
        ],
        requirementIds: [2, 9, 10, 12],
      },
    ],
    stages: [
      {
        id: "stage-1",
        name: "Canonical 治理与执行透明度",
        ordinal: 1,
        goal: "让关键词决策、重复关系、交付来源、阻断、进度和原始排名历史成为可持久、可审计的正式能力。",
        scope: [
          "Topic Identity 与 Keyword Review/Mapping authority 基础",
          "Duplicate/Cannibalization Candidate 与 Decision",
          "Artifact Source Sidecar",
          "Action Blocker 与业务 Progress",
          "Keyword Metric History 原始序列",
        ],
        dependencies: [
          "Publication/Change Receipt 与 Measurement 基础完成迁移收敛",
          "现有关键词、页面、竞品、Evidence、Finding、Action 与 Artifact 底座",
        ],
        exitGate: [
          "所有客户编辑刷新后仍存在，旧 Revision 冲突 fail closed。",
          "所有决策可审计，来源有 lineage，阻断与进度不是前端推测。",
          "排名历史来自真实 Observation；没有 Receipt 时不显示变更事件。",
          "DB Integration、Contract、Service 和 E2E 全绿。",
        ],
        exclusions: [
          "不在本阶段交付完整 Topic Graph 或 Internal Link Graph。",
          "不把原始排名历史误报为 Receipt-backed Results。",
          "不接入未批准的外部评论、GEO 或 Backlink Provider。",
        ],
        requirementIds: [1, 2, 4, 5, 6, 9],
      },
      {
        id: "stage-2",
        name: "结构与持续监控",
        ordinal: 2,
        goal: "把治理对象扩展为可视结构和持续监控，并从真实变化回到 Overview、Opportunity 与 Execution。",
        scope: [
          "完整 Topic Map",
          "Canonical Internal Link Graph",
          "Opportunity SLA、Decision 与 Snooze",
          "Content Decay Policy 与 Alert",
          "Competitor Policy、Snapshot 与 Delta",
          "Receipt-backed Keyword Change Event 与 Results 对比",
        ],
        dependencies: [
          "Stage 1 authority 与客户写命令稳定",
          "正式 Publication/Change Receipt、Outcome Collection 与固定 Measurement Window",
          "页面/链接、关键词与竞品不可变 Observation",
        ],
        exitGate: [
          "Graph 来自 canonical node/edge，Reminder 可去重、延后、拒绝和推进。",
          "Alert 显示窗口、阈值、样本、缺数和新鲜度。",
          "生成 Action 后可进入 Execution，重新采集不覆写历史。",
          "Keyword Results 只锚定真实 Receipt 与固定 Measurement Window。",
        ],
        exclusions: [
          "不从 Finding 文案临时反推 Graph。",
          "不使用简单固定阈值跳过样本与季节性保护。",
          "不把静态竞品字段伪造成历史变化。",
        ],
        requirementIds: [1, 7, 8, 9, 10, 13],
      },
      {
        id: "stage-3",
        name: "外部证据",
        ordinal: 3,
        goal: "在授权、成本和数据治理明确后，引入 VOC、GEO、Backlink 与更完整的竞品动态证据。",
        scope: [
          "Interview Summary 与 User Review 来源",
          "GEO Citation Observation",
          "Backlink 受治理导入与 Provider-neutral adapter",
          "完整竞品动态来源",
        ],
        dependencies: [
          "Provider 授权、使用条款、频率、成本、速率与保留策略审批",
          "统一 Snapshot/Pointer/Freshness 与 Customer Visibility",
          "Stage 1–2 的稳定身份、决策与监控基础",
        ],
        exitGate: [
          "所有来源拥有 Snapshot/Pointer/Freshness 和清晰的许可边界。",
          "没有 Provider 时显示 unavailable，不显示 mock 指标。",
          "客户连接面保持真实，GEO 文案不做因果夸大。",
          "真实 Provider 或受治理文件导入通过 Integration/E2E。",
        ],
        exclusions: [
          "第三方 Provider 深度接入不属于当前上线承诺。",
          "不新增 G2、Capterra、Ahrefs、Moz 等虚假客户连接卡。",
          "不在未获授权时采集、保留或披露外部内容。",
        ],
        requirementIds: [3, 11, 12, 13],
      },
    ],
    acceptanceLayers: [
      {
        id: "data",
        name: "数据与 Domain",
        description:
          "Migration、稳定身份、不可变 Observation/Decision/Receipt 与 Repository invariant。",
      },
      {
        id: "contract",
        name: "Contract / API",
        description:
          "Zod、OpenAPI、Generated Client、Scope、Revision、Cursor 与 unavailable 语义一致。",
      },
      {
        id: "service",
        name: "Service / Route",
        description:
          "服务读取 canonical authority，写命令具备 Idempotency、Expected Revision 与 fail-closed 行为。",
      },
      {
        id: "ui",
        name: "客户界面",
        description:
          "中文优先、可访问、刷新可恢复；每个可见动作都有真实页面、抽屉、命令或明确 unavailable。",
      },
      {
        id: "mutation",
        name: "Mutation / Audit",
        description:
          "客户决策、状态变化和发布/变更都有 append-only 审计记录与可重放 Pointer。",
      },
      {
        id: "tests",
        name: "Unit / Integration / E2E",
        description:
          "正常路径、并发、缺数、陈旧、不可用、幂等、权限与关键客户流程都有自动化证据。",
      },
      {
        id: "provider",
        name: "真实 Provider 或诚实不可用",
        description:
          "外部数据必须有真实授权与采集证据；不存在时返回结构化 unavailable，绝不以场景数据补位。",
      },
    ],
  };

  global.NevermoreKeywordAudit = deepFreeze(audit);
})(window);
