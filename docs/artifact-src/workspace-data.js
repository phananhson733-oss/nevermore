(function attachGenGrowthWorkspace(global) {
  'use strict';

  const enums = {
    datasetKind: { SCENARIO: 'scenario' },
    lens: {
      DIAGNOSIS: 'diagnosis',
      WEBTECH: 'webtech',
      ACQUISITION: 'acquisition',
      LANDING: 'landing',
    },
    sourceStatus: {
      SCENARIO_SNAPSHOT: 'scenario_snapshot',
      MANUAL_SNAPSHOT: 'manual_snapshot',
      PLANNED: 'planned',
      UNAVAILABLE: 'unavailable',
    },
    sourceVisibility: {
      CUSTOMER: 'customer',
      INTERNAL: 'internal',
    },
    profileStatus: {
      DRAFT: 'draft',
      REVIEW: 'review',
      CONFIRMED: 'confirmed',
      SUPERSEDED: 'superseded',
    },
    profileFieldStatus: {
      CONFIRMED: 'confirmed',
      INFERRED: 'inferred',
      NEEDS_REVIEW: 'needs_review',
      MISSING: 'missing',
      CONFLICTING: 'conflicting',
    },
    profileFieldConfidence: {
      HIGH: 'high',
      MEDIUM: 'medium',
      LOW: 'low',
      UNKNOWN: 'unknown',
    },
    urlStatus: {
      MONITORING: 'monitoring',
      ACTION_REQUIRED: 'action_required',
      IN_EXECUTION: 'in_execution',
      REVIEW: 'review',
      VERIFIED: 'verified',
    },
    findingStatus: {
      UNREVIEWED: 'unreviewed',
      CONFIRMED: 'confirmed',
      DISMISSED: 'dismissed',
    },
    opportunityStatus: {
      IDENTIFIED: 'identified',
      CONFIRMED: 'confirmed',
      IN_EXECUTION: 'in_execution',
      DELIVERED: 'delivered',
      OBSERVING: 'observing',
      CLOSED: 'closed',
      DISMISSED: 'dismissed',
    },
    keywordStatus: {
      NEW: 'new',
      OPPORTUNITY: 'opportunity',
      BRIEF_READY: 'brief_ready',
      DRAFTING: 'drafting',
      REVIEW: 'review',
      MONITORING: 'monitoring',
    },
    competitorStatus: {
      CANDIDATE: 'candidate',
      APPROVED: 'approved',
      EXCLUDED: 'excluded',
    },
    artifactStatus: {
      DRAFT: 'draft',
      REVIEW: 'review',
      APPROVED: 'approved',
      IN_EXECUTION: 'in_execution',
      PUBLISHED: 'published',
      BLOCKED: 'blocked',
    },
    verificationStatus: {
      VERIFIED: 'verified',
      NOT_RESOLVED: 'not_resolved',
      UNAVAILABLE: 'unavailable',
    },
    observationStatus: {
      OBSERVED: 'observed',
      INSUFFICIENT: 'insufficient',
      NOT_OBSERVED: 'not_observed',
      UNAVAILABLE: 'unavailable',
    },
    auditEventType: {
      SNAPSHOT_CREATED: 'snapshot_created',
      PROFILE_CONFIRMED: 'profile_confirmed',
      FINDING_CONFIRMED: 'finding_confirmed',
      FINDING_REVIEWED: 'finding_reviewed',
      ACTION_CREATED: 'action_created',
      ARTIFACT_REVISED: 'artifact_revised',
      ARTIFACT_APPROVED: 'artifact_approved',
      CHANGE_PUBLISHED: 'change_published',
      RECHECK_COMPLETED: 'recheck_completed',
      OBSERVATION_RECORDED: 'observation_recorded',
      OPPORTUNITY_REVIEWED: 'opportunity_reviewed',
      KEYWORD_ADDED: 'keyword_added',
      COMPETITOR_REVIEWED: 'competitor_reviewed',
      REPORT_SHARED: 'report_shared',
      SYNC_COMPLETED: 'sync_completed',
    },
  };

  const labelsZh = {
    lens: {
      diagnosis: '产品与市场',
      webtech: '网站技术',
      acquisition: 'SEO / GEO 内容',
      landing: '落地页与转化',
    },
    sourceStatus: {
      scenario_snapshot: '场景快照',
      manual_snapshot: '手工快照',
      planned: '待接入',
      unavailable: '不可用',
    },
    profileStatus: {
      draft: '草稿',
      review: '待审核',
      confirmed: '已确认',
      superseded: '已被新版本替代',
    },
    profileFieldStatus: {
      confirmed: '已确认',
      inferred: '基于证据推断',
      needs_review: '待审核',
      missing: '缺少信息',
      conflicting: '证据冲突',
    },
    profileFieldConfidence: {
      high: '高',
      medium: '中',
      low: '低',
      unknown: '未知',
    },
    urlStatus: {
      monitoring: '监测中',
      action_required: '待处理',
      in_execution: '执行中',
      review: '待审核',
      verified: '已验证',
    },
    findingStatus: {
      unreviewed: '待审核',
      confirmed: '已确认',
      dismissed: '已排除',
    },
    opportunityStatus: {
      identified: '已识别',
      needs_data: '需要更多数据',
      confirmed: '已确认',
      in_execution: '执行中',
      delivered: '已交付',
      observing: '观察中',
      closed: '已关闭',
      dismissed: '已排除',
    },
    keywordStatus: {
      new: '新入库',
      opportunity: '待评估',
      brief_ready: 'Brief 就绪',
      drafting: '撰写中',
      review: '待审核',
      monitoring: '监测中',
    },
    competitorStatus: {
      candidate: '候选',
      approved: '已确认',
      excluded: '已排除',
    },
    artifactStatus: {
      draft: '草稿',
      review: '待审核',
      approved: '已批准',
      in_execution: '执行中',
      published: '场景已发布',
      blocked: '已阻断',
    },
    artifactType: {
      technical_ticket: 'Technical Ticket / 技术工单',
      code_patch: '代码修复方案',
      metadata_rewrite: 'Metadata Rewrite / 元数据重写',
      content_brief: 'Content Brief / 内容简报',
      english_blog_draft: 'English Blog Draft',
      schema_patch: 'Schema Patch / 结构化数据修复',
      landing_revision: 'Landing Revision Brief / 落地页改版',
      publish_receipt: 'Publish / Change Receipt / 发布与变更回执',
      utm_plan: 'UTM Plan / UTM 追踪计划',
      comparison_brief: 'Comparison Brief / 竞品对比简报',
    },
    verificationStatus: {
      verified: '已验证',
      not_resolved: '未解决',
      unavailable: '不可用',
    },
    observationStatus: {
      observed: '观察到变化',
      insufficient: '数据不足',
      not_observed: '固定窗口未观察',
      unavailable: '不可用',
    },
    freshness: {
      fresh: '新鲜',
      aging: '即将过期',
      stale: '已过期',
      unavailable: '不可用',
    },
  };

  const historicalProfile = {
    id: 'prof-relayops-v3',
    projectId: 'prj-relayops-us',
    version: 3,
    status: enums.profileStatus.SUPERSEDED,
    createdAt: '2026-06-28T07:10:00.000Z',
    confirmedAt: '2026-06-28T08:15:00.000Z',
    supersededAt: '2026-07-20T08:40:00.000Z',
    profileFieldCount: 11,
    confirmedFieldCount: 2,
    lowConfidenceFieldCount: 3,
    pendingConfirmationCount: 9,
    missingFieldCount: 4,
    conflictingFieldCount: 1,
    productCategory: 'customer_onboarding_automation',
    productCategoryLabel: '客户上线自动化',
    oneLiner: '面向客户成功团队的客户上线自动化平台。',
    valueProposition: '用标准工作流统一客户上线协作，减少人工跟进。',
    businessModel: {
      type: 'b2b_saas_subscription',
      label: '企业软件订阅制',
      revenueModel: '年度订阅',
      salesMotion: '销售辅助型',
      pricingBasis: '当时尚未确认',
    },
    offer: {
      coreProduct: '客户上线自动化平台',
      package: '标准工作流与进度跟踪',
      primaryOutcome: '减少客户成功团队的人工协调',
      differentiation: [],
    },
    primaryMarket: {
      countryCode: 'US',
      geography: '美国',
      language: '英语',
      segment: '面向企业客户的成长型订阅软件公司',
      contentLanguage: '英语',
    },
    buyer: {
      primaryRole: '客户成功负责人',
      economicBuyer: '尚未确认',
      champion: '客户成功运营负责人',
      decisionCriteria: [],
      successMetrics: ['客户上线周期'],
    },
    users: [
      { role: '客户成功团队', responsibility: '跟进客户上线进度', need: '减少重复提醒' },
    ],
    JTBD: [
      { id: 'jtbd-standardize', job: '标准化客户上线流程', desiredOutcome: '让每位客户获得一致的上线体验', priority: '核心' },
    ],
    buyingTriggers: ['客户上线数量快速增长'],
    pains: [],
    useCases: [],
    primaryIcp: {
      company: '面向企业客户的成长型订阅软件公司',
      buyer: '客户成功负责人',
      champion: '客户成功运营负责人',
      users: ['客户成功团队'],
      jobsToBeDone: ['标准化客户上线流程'],
      buyingTriggers: ['客户上线数量快速增长'],
      pains: [],
      useCases: [],
    },
    profileFields: [
      {
        key: 'businessModel',
        section: 'business',
        label: '商业模式',
        value: '年度订阅制企业软件；具体计价依据尚未确认',
        derivation: '根据公开定价页与产品页面推断，尚未获得客户对计价依据的确认。',
        evidenceRefs: ['src-crawl'],
        confidence: enums.profileFieldConfidence.MEDIUM,
        status: enums.profileFieldStatus.INFERRED,
      },
      {
        key: 'offer',
        section: 'business',
        label: '核心方案',
        value: '标准化客户上线工作流与进度跟踪',
        derivation: '归纳首页与产品页中重复出现的功能描述。',
        evidenceRefs: ['src-crawl'],
        confidence: enums.profileFieldConfidence.MEDIUM,
        status: enums.profileFieldStatus.INFERRED,
      },
      {
        key: 'primaryMarket',
        section: 'market',
        label: '主要市场',
        value: '美国 · 英语 · 面向企业客户的成长型订阅软件公司',
        derivation: '客户确认了美国市场及英语内容范围。',
        evidenceRefs: ['src-manual-profile'],
        confidence: enums.profileFieldConfidence.HIGH,
        status: enums.profileFieldStatus.CONFIRMED,
      },
      {
        key: 'buyer',
        section: 'audience',
        label: '主要决策者',
        value: ['客户成功负责人', '客户运营负责人'],
        derivation: '网站文案指向客户成功负责人，访谈摘要则多次提到客户运营负责人；当时尚未完成角色拆分。',
        evidenceRefs: ['src-crawl', 'src-customer-notes'],
        confidence: enums.profileFieldConfidence.LOW,
        status: enums.profileFieldStatus.CONFLICTING,
      },
      {
        key: 'users',
        section: 'audience',
        label: '核心使用者',
        value: ['客户成功团队'],
        derivation: '由产品页面受众描述推断，尚未区分运营、实施与一线客户成功经理。',
        evidenceRefs: ['src-crawl'],
        confidence: enums.profileFieldConfidence.MEDIUM,
        status: enums.profileFieldStatus.INFERRED,
      },
      {
        key: 'JTBD',
        section: 'needs',
        label: '待完成任务',
        value: ['标准化客户上线流程'],
        derivation: '客户确认该任务是采购与采用产品的首要目标。',
        evidenceRefs: ['src-manual-profile'],
        confidence: enums.profileFieldConfidence.HIGH,
        status: enums.profileFieldStatus.CONFIRMED,
      },
      {
        key: 'buyingTriggers',
        section: 'needs',
        label: '购买触发因素',
        value: ['客户上线数量快速增长'],
        derivation: '从访谈摘要中重复出现的时点信号归纳。',
        evidenceRefs: ['src-customer-notes'],
        confidence: enums.profileFieldConfidence.MEDIUM,
        status: enums.profileFieldStatus.INFERRED,
      },
      {
        key: 'pains',
        section: 'needs',
        label: '主要痛点',
        value: null,
        derivation: '当时的已批准证据未形成可确认的具体痛点清单。',
        evidenceRefs: ['src-customer-notes'],
        confidence: enums.profileFieldConfidence.LOW,
        status: enums.profileFieldStatus.MISSING,
      },
      {
        key: 'useCases',
        section: 'needs',
        label: '典型使用场景',
        value: null,
        derivation: '当时的产品页面只描述功能，无法可靠还原具体使用场景。',
        evidenceRefs: ['src-crawl'],
        confidence: enums.profileFieldConfidence.LOW,
        status: enums.profileFieldStatus.MISSING,
      },
      {
        key: 'procurementRequirements',
        section: 'qualification',
        label: '采购与法务要求',
        value: null,
        derivation: '现有页面与访谈摘要未提供采购流程、法务条款或预算门槛。',
        evidenceRefs: ['src-crawl', 'src-customer-notes'],
        confidence: enums.profileFieldConfidence.UNKNOWN,
        status: enums.profileFieldStatus.MISSING,
      },
      {
        key: 'securityApprovalOwner',
        section: 'qualification',
        label: '安全审批负责人',
        value: null,
        derivation: '当时没有足够证据识别安全审批角色。',
        evidenceRefs: ['src-crawl'],
        confidence: enums.profileFieldConfidence.UNKNOWN,
        status: enums.profileFieldStatus.MISSING,
      },
    ],
    evidenceRefs: ['src-crawl', 'src-manual-profile', 'src-customer-notes'],
  };

  const currentProfile = {
    id: 'prof-relayops-v4',
    projectId: 'prj-relayops-us',
    version: 4,
    status: enums.profileStatus.CONFIRMED,
    createdAt: '2026-07-20T08:20:00.000Z',
    confirmedAt: '2026-07-20T08:40:00.000Z',
    supersededAt: null,
    profileFieldCount: 11,
    confirmedFieldCount: 9,
    lowConfidenceFieldCount: 2,
    pendingConfirmationCount: 2,
    missingFieldCount: 1,
    conflictingFieldCount: 1,
    productCategory: 'customer_onboarding_automation',
    productCategoryLabel: '客户上线协作自动化',
    oneLiner: '面向客户运营团队的客户上线协作平台。',
    valueProposition: '让销售、客户成功与实施团队共享一条可追踪的客户上线工作流。',
    businessModel: {
      type: 'b2b_saas_subscription',
      label: '企业软件订阅制',
      revenueModel: '年度订阅',
      salesMotion: '销售辅助型',
      pricingBasis: '按协作席位与客户上线规模分层',
    },
    offer: {
      coreProduct: '客户上线协作平台',
      package: '标准化工作流、跨团队交接与风险预警',
      primaryOutcome: '缩短客户实现首个价值的时间，并减少跨团队信息丢失',
      differentiation: [
        '围绕实施型客户上线，而非只做产品内引导',
        '让销售、客户成功与实施团队共享同一进度和责任记录',
        '保留需要人工判断的关键节点，自动化重复协调工作',
      ],
    },
    primaryMarket: {
      countryCode: 'US',
      geography: '美国',
      language: '英语',
      segment: '50–500 人、面向企业客户的成长型订阅软件公司',
      contentLanguage: '英语',
    },
    buyer: {
      primaryRole: '客户成功副总裁',
      economicBuyer: '客户成功或客户运营负责人',
      champion: '客户成功运营负责人',
      decisionCriteria: ['能否统一跨团队交接', '能否提前暴露实施风险', '能否缩短价值实现周期'],
      successMetrics: ['客户上线周期', '按期上线率', '升级事件数量', '首次价值实现时间'],
    },
    users: [
      { role: '客户成功运营负责人', responsibility: '设计流程、模板与衡量口径', need: '在不增加人工协调的前提下扩展上线规模' },
      { role: '实施经理', responsibility: '管理项目计划、依赖与风险', need: '获得清晰的责任人、截止时间和风险信号' },
      { role: '客户成功经理', responsibility: '推动客户完成里程碑并维护关系', need: '保留销售交接背景并减少重复询问' },
    ],
    JTBD: [
      { id: 'jtbd-standardize', job: '标准化客户上线流程', desiredOutcome: '让不同客户和负责人获得一致的交付质量', priority: '核心' },
      { id: 'jtbd-preserve-context', job: '保留跨团队交接背景', desiredOutcome: '让实施与客户成功团队无需重新向客户收集信息', priority: '核心' },
      { id: 'jtbd-detect-risk', job: '更早发现交付风险', desiredOutcome: '在延期或升级发生前触发干预', priority: '核心' },
    ],
    buyingTriggers: ['客户上线数量快速增长', '新任客户成功负责人上任', '企业客户升级事件频繁发生', '团队准备统一销售到实施的交接流程'],
    pains: ['交接信息散落在表格、邮件和会议记录中', '不同实施经理使用不同流程，交付质量不稳定', '风险往往在客户升级后才被发现', '团队扩张后依赖人工提醒，运营成本持续上升'],
    useCases: [
      { name: '销售到实施交接', outcome: '把成交背景、承诺与责任人带入客户上线计划' },
      { name: '标准化客户上线计划', outcome: '按客户类型复用里程碑、任务和成功标准' },
      { name: '实施风险预警', outcome: '根据逾期任务、依赖和客户响应提前识别风险' },
      { name: '客户上线复盘', outcome: '比较周期、按期率和升级事件，持续优化流程' },
    ],
    primaryIcp: {
      company: '50–500 人、面向企业客户的成长型订阅软件公司',
      buyer: '客户成功副总裁',
      champion: '客户成功运营负责人',
      users: ['客户成功运营负责人', '实施经理', '客户成功经理'],
      jobsToBeDone: ['标准化客户上线流程', '保留跨团队交接背景', '更早发现交付风险'],
      buyingTriggers: ['客户上线数量快速增长', '新任客户成功负责人上任', '企业客户升级事件频繁发生', '团队准备统一销售到实施的交接流程'],
      pains: ['交接信息分散', '交付流程不一致', '风险发现过晚', '人工协调成本上升'],
      useCases: ['销售到实施交接', '标准化客户上线计划', '实施风险预警', '客户上线复盘'],
    },
    profileFields: [
      {
        key: 'businessModel',
        section: 'business',
        label: '商业模式',
        value: '年度订阅制企业软件；销售辅助成交，按协作席位与客户上线规模分层',
        derivation: '结合公开定价页、产品页面与客户确认画像，归纳收入模式、销售方式和计价依据。',
        evidenceRefs: ['src-crawl', 'src-manual-profile'],
        confidence: enums.profileFieldConfidence.HIGH,
        status: enums.profileFieldStatus.CONFIRMED,
      },
      {
        key: 'offer',
        section: 'business',
        label: '核心方案',
        value: '客户上线协作平台，提供标准化工作流、跨团队交接和风险预警',
        derivation: '从首页、产品页与访谈摘要中重复出现的能力和结果表述归纳，并由客户确认。',
        evidenceRefs: ['src-crawl', 'src-customer-notes', 'src-manual-profile'],
        confidence: enums.profileFieldConfidence.HIGH,
        status: enums.profileFieldStatus.CONFIRMED,
      },
      {
        key: 'primaryMarket',
        section: 'market',
        label: '主要市场',
        value: '美国 · 英语 · 50–500 人、面向企业客户的成长型订阅软件公司',
        derivation: '客户确认了地域、内容语言与目标公司规模；网站页面用于交叉核对。',
        evidenceRefs: ['src-manual-profile', 'src-crawl'],
        confidence: enums.profileFieldConfidence.HIGH,
        status: enums.profileFieldStatus.CONFIRMED,
      },
      {
        key: 'buyer',
        section: 'audience',
        label: '主要决策者',
        value: '主要决策者：客户成功副总裁；内部推动者：客户成功运营负责人',
        derivation: '综合已批准访谈摘要与客户确认画像，将经济决策者、业务决策者和内部推动者分开。',
        evidenceRefs: ['src-customer-notes', 'src-manual-profile'],
        confidence: enums.profileFieldConfidence.HIGH,
        status: enums.profileFieldStatus.CONFIRMED,
      },
      {
        key: 'users',
        section: 'audience',
        label: '核心使用者',
        value: ['客户成功运营负责人', '实施经理', '客户成功经理'],
        derivation: '根据访谈中的实际协作角色归纳，并由客户确认，不再把决策者与日常使用者混为一谈。',
        evidenceRefs: ['src-customer-notes', 'src-manual-profile'],
        confidence: enums.profileFieldConfidence.HIGH,
        status: enums.profileFieldStatus.CONFIRMED,
      },
      {
        key: 'JTBD',
        section: 'needs',
        label: '待完成任务',
        value: ['标准化客户上线流程', '保留跨团队交接背景', '更早发现交付风险'],
        derivation: '将访谈中的期望结果按任务而非功能重新表述，并由客户确认优先级。',
        evidenceRefs: ['src-customer-notes', 'src-manual-profile'],
        confidence: enums.profileFieldConfidence.HIGH,
        status: enums.profileFieldStatus.CONFIRMED,
      },
      {
        key: 'buyingTriggers',
        section: 'needs',
        label: '购买触发因素',
        value: ['客户上线数量快速增长', '新任客户成功负责人上任', '企业客户升级事件频繁发生', '准备统一销售到实施的交接流程'],
        derivation: '从已批准访谈中识别采购或替换工具之前反复出现的组织变化与风险事件。',
        evidenceRefs: ['src-customer-notes', 'src-manual-profile'],
        confidence: enums.profileFieldConfidence.HIGH,
        status: enums.profileFieldStatus.CONFIRMED,
      },
      {
        key: 'pains',
        section: 'needs',
        label: '主要痛点',
        value: ['交接信息分散', '交付流程不一致', '风险发现过晚', '人工协调成本上升'],
        derivation: '把访谈中的现状描述合并为四类可用于诊断和文案的信息，不把单次抱怨提升为普遍结论。',
        evidenceRefs: ['src-customer-notes'],
        confidence: enums.profileFieldConfidence.HIGH,
        status: enums.profileFieldStatus.CONFIRMED,
      },
      {
        key: 'useCases',
        section: 'needs',
        label: '典型使用场景',
        value: ['销售到实施交接', '标准化客户上线计划', '实施风险预警', '客户上线复盘'],
        derivation: '将产品能力映射到访谈中的真实工作流程，并通过产品页和客户确认画像交叉核对。',
        evidenceRefs: ['src-crawl', 'src-customer-notes', 'src-manual-profile'],
        confidence: enums.profileFieldConfidence.HIGH,
        status: enums.profileFieldStatus.CONFIRMED,
      },
      {
        key: 'procurementRequirements',
        section: 'qualification',
        label: '采购与法务要求',
        value: null,
        derivation: '现有公开页面与访谈摘要未提供采购周期、法务条款、预算门槛或必需集成清单。',
        evidenceRefs: ['src-crawl', 'src-customer-notes'],
        confidence: enums.profileFieldConfidence.LOW,
        status: enums.profileFieldStatus.MISSING,
      },
      {
        key: 'securityApprovalOwner',
        section: 'qualification',
        label: '安全审批负责人',
        value: ['信息安全负责人', '法务负责人'],
        derivation: '安全页暗示由信息安全角色审核，访谈摘要则由法务角色负责；缺少客户确认，暂不合并为单一结论。',
        evidenceRefs: ['src-crawl', 'src-customer-notes'],
        confidence: enums.profileFieldConfidence.LOW,
        status: enums.profileFieldStatus.CONFLICTING,
      },
    ],
    evidenceRefs: ['src-crawl', 'src-manual-profile', 'src-customer-notes'],
  };

  const profileVersions = [
    {
      id: 'prof-version-relayops-v3',
      profileId: historicalProfile.id,
      projectId: historicalProfile.projectId,
      version: historicalProfile.version,
      status: historicalProfile.status,
      recordedAt: '2026-06-28T08:15:00.000Z',
      confirmedAt: historicalProfile.confirmedAt,
      supersededAt: historicalProfile.supersededAt,
      snapshotMode: 'full',
      changeSummary: '建立首个客户确认画像，但决策者与使用者尚未拆分，痛点、使用场景和采购条件仍缺少证据。',
      changedFieldKeys: ['businessModel', 'offer', 'primaryMarket', 'buyer', 'users', 'JTBD', 'buyingTriggers'],
      snapshot: historicalProfile,
    },
    {
      id: 'prof-version-relayops-v4',
      profileId: currentProfile.id,
      projectId: currentProfile.projectId,
      version: currentProfile.version,
      status: currentProfile.status,
      recordedAt: '2026-07-20T08:40:00.000Z',
      confirmedAt: currentProfile.confirmedAt,
      supersededAt: null,
      snapshotMode: 'full',
      previousVersionId: 'prof-version-relayops-v3',
      changeSummary: '拆分决策者、内部推动者与日常使用者，补齐痛点和使用场景，并保留采购要求缺失与安全审批角色冲突。',
      changedFieldKeys: ['businessModel', 'offer', 'buyer', 'users', 'JTBD', 'buyingTriggers', 'pains', 'useCases', 'securityApprovalOwner'],
      snapshot: currentProfile,
    },
  ];

  const scenarioLabel = '离线演示场景 · 非真实客户数据';
  const attributionBoundary = '对象之间仅表示同一目标、工作流或观察窗口的可追溯关系；回执不等于效果，固定窗口内的共同变化不证明由单一交付物、发布或 Campaign 造成。';

  const dataset = {
    schemaVersion: 'gengrowth-workspace.v1',
    datasetKind: enums.datasetKind.SCENARIO,
    snapshotAt: '2026-07-21T09:30:00.000Z',
    scenarioNotice: `${scenarioLabel}。用于 RelayOps 客户交付物的确定性场景快照；不代表已连接真实 GSC、GA4、GitHub、内容管理系统或第三方数据服务。`,
    project: {
      id: 'prj-relayops-us',
      slug: 'relayops-us-growth',
      name: 'RelayOps',
      website: 'https://relayops.com',
      primaryMarket: 'US',
      customerModel: 'b2b',
      businessModel: 'saas_subscription',
      primaryConversionId: 'conv-demo-requested',
      conversionGoals: [
        { id: 'conv-demo-requested', eventName: 'demo_requested', label: '申请产品演示', kind: 'primary' },
        { id: 'conv-workflow-review', eventName: 'workflow_review_requested', label: '申请工作流评估', kind: 'secondary' },
        { id: 'conv-guide-download', eventName: 'guide_downloaded', label: '下载指南', kind: 'secondary' },
      ],
    },
    profile: currentProfile,
    profileVersionPolicy: {
      strategy: 'append_only',
      snapshotMode: 'full',
      currentVersion: currentProfile.version,
      note: '每次确认都追加完整快照；历史版本不会被原地改写。',
    },
    profileVersions: profileVersions,
    dataSources: [
      { id: 'src-sitemap', kind: 'sitemap', name: '站点地图快照', status: 'scenario_snapshot', audienceVisibility: 'internal', externalConnection: false, observedAt: '2026-07-21T09:18:00.000Z', freshnessSlaHours: 24, recordScope: '场景 URL 清单' },
      { id: 'src-crawl', kind: 'crawl', name: '渲染抓取快照', status: 'scenario_snapshot', audienceVisibility: 'internal', externalConnection: false, observedAt: '2026-07-21T09:20:00.000Z', freshnessSlaHours: 24, recordScope: '场景 URL 清单' },
      { id: 'src-gsc', kind: 'search_console', name: 'Google Search Console', status: 'scenario_snapshot', connectionState: 'available', audienceVisibility: 'customer', externalConnection: false, observedAt: '2026-07-21T08:45:00.000Z', freshnessSlaHours: 48, recordScope: '搜索词、落地页与固定窗口表现', capabilities: ['search_performance', 'query_page_mapping', 'index_observation'] },
      { id: 'src-ga4', kind: 'analytics', name: 'Google Analytics 4', status: 'scenario_snapshot', connectionState: 'available', audienceVisibility: 'customer', externalConnection: false, observedAt: '2026-07-21T08:50:00.000Z', freshnessSlaHours: 48, recordScope: '页面、UTM 活动与转化观察', capabilities: ['page_performance', 'campaign_utm', 'conversion_observation'] },
      { id: 'src-github', kind: 'github', name: 'GitHub', status: 'planned', connectionState: 'unavailable', audienceVisibility: 'customer', externalConnection: false, observedAt: null, freshnessSlaHours: 24, recordScope: '代码修复、GitHub PR、人工合并与回滚回执', capabilities: ['pull_request', 'review_gate', 'merge_receipt'], plannedFlow: ['从已批准的代码修复创建分支', '生成 GitHub PR 与变更预览', '客户或工程团队审核并合并', '回写合并与回滚回执'] },
      { id: 'src-serp', kind: 'serp_provider', name: '搜索结果页场景快照', status: 'scenario_snapshot', audienceVisibility: 'internal', externalConnection: false, observedAt: '2026-07-20T03:00:00.000Z', freshnessSlaHours: 72, recordScope: '美国市场 Keyword 样本' },
      { id: 'src-ai-answers', kind: 'ai_answer_capture', name: '固定生成式问答问题集采样', status: 'scenario_snapshot', audienceVisibility: 'internal', externalConnection: false, observedAt: '2026-07-18T06:00:00.000Z', freshnessSlaHours: 168, recordScope: '固定问答问题集' },
      { id: 'src-manual-profile', kind: 'customer_confirmed', name: '已确认的产品画像 v4', status: 'manual_snapshot', audienceVisibility: 'internal', externalConnection: false, observedAt: '2026-07-20T08:40:00.000Z', freshnessSlaHours: 720, recordScope: '产品、ICP 与购买背景' },
      { id: 'src-customer-notes', kind: 'customer_notes', name: '已批准的客户访谈摘要', status: 'manual_snapshot', audienceVisibility: 'internal', externalConnection: false, observedAt: '2026-07-15T02:00:00.000Z', freshnessSlaHours: 720, recordScope: '已批准的访谈摘要' },
      { id: 'src-competitor-corpus', kind: 'competitor_corpus', name: '已批准的竞品场景语料', status: 'manual_snapshot', audienceVisibility: 'internal', externalConnection: false, observedAt: '2026-07-19T07:30:00.000Z', freshnessSlaHours: 168, recordScope: '场景竞品语料' },
      { id: 'src-cms', kind: 'cms', name: '内容管理系统场景回执', status: 'scenario_snapshot', audienceVisibility: 'internal', externalConnection: false, observedAt: '2026-07-21T03:06:00.000Z', freshnessSlaHours: 24, recordScope: '一次模拟发布回执' },
    ],
    urls: [
      { id: 'url-home', projectId: 'prj-relayops-us', path: '/', title: 'RelayOps', pageType: 'home', templateKey: 'marketing-home', clusterId: 'clu-brand', status: 'monitoring', priority: 'p1', sourceRefs: ['src-sitemap', 'src-crawl'] },
      { id: 'url-onboarding', projectId: 'prj-relayops-us', path: '/customer-onboarding/', title: 'Customer Onboarding Software', pageType: 'product', templateKey: 'commercial-product', clusterId: 'clu-onboarding', status: 'in_execution', priority: 'p0', sourceRefs: ['src-sitemap', 'src-crawl', 'src-gsc'] },
      { id: 'url-blog-automation', projectId: 'prj-relayops-us', path: '/blog/customer-onboarding-automation/', title: 'Customer Onboarding Automation Guide', pageType: 'blog', templateKey: 'editorial-article', clusterId: 'clu-onboarding', status: 'review', priority: 'p0', sourceRefs: ['src-sitemap', 'src-crawl', 'src-gsc', 'src-ai-answers'] },
      { id: 'url-salesforce', projectId: 'prj-relayops-us', path: '/integrations/salesforce/', title: 'Salesforce Integration', pageType: 'integration', templateKey: 'integration-detail', clusterId: 'clu-integrations', status: 'action_required', priority: 'p1', sourceRefs: ['src-sitemap', 'src-crawl', 'src-gsc'] },
      { id: 'url-compare-userpilot', projectId: 'prj-relayops-us', path: '/compare/userpilot/', title: 'RelayOps vs Userpilot', pageType: 'comparison', templateKey: 'comparison-detail', clusterId: 'clu-alternatives', status: 'review', priority: 'p1', sourceRefs: ['src-sitemap', 'src-crawl', 'src-serp', 'src-competitor-corpus'] },
      { id: 'url-pricing', projectId: 'prj-relayops-us', path: '/pricing/', title: 'Pricing', pageType: 'commercial', templateKey: 'commercial-conversion', clusterId: 'clu-commercial', status: 'review', priority: 'p1', sourceRefs: ['src-sitemap', 'src-crawl', 'src-ga4'] },
      { id: 'url-checklist', projectId: 'prj-relayops-us', path: '/resources/onboarding-checklist/', title: 'Customer Onboarding Checklist', pageType: 'resource', templateKey: 'editorial-resource', clusterId: 'clu-onboarding', status: 'monitoring', priority: 'p1', sourceRefs: ['src-sitemap', 'src-crawl', 'src-gsc'] },
      { id: 'url-time-to-value', projectId: 'prj-relayops-us', path: '/blog/time-to-value/', title: 'How to Reduce Time to Value', pageType: 'blog', templateKey: 'editorial-article', clusterId: 'clu-measurement', status: 'action_required', priority: 'p2', sourceRefs: ['src-sitemap', 'src-crawl', 'src-gsc'] },
      { id: 'url-security', projectId: 'prj-relayops-us', path: '/security/', title: 'Security & Compliance', pageType: 'trust', templateKey: 'trust-center', clusterId: 'clu-brand', status: 'action_required', priority: 'p2', sourceRefs: ['src-sitemap', 'src-crawl'] },
      { id: 'url-solution-cs', projectId: 'prj-relayops-us', path: '/solutions/customer-success/', title: 'Customer Success Teams', pageType: 'solution', templateKey: 'solution-detail', clusterId: 'clu-onboarding', status: 'review', priority: 'p1', sourceRefs: ['src-sitemap', 'src-crawl', 'src-manual-profile'] },
      { id: 'url-template-plan', projectId: 'prj-relayops-us', path: '/templates/onboarding-plan/', title: 'Onboarding Plan Template', pageType: 'template', templateKey: 'downloadable-template', clusterId: 'clu-onboarding', status: 'monitoring', priority: 'p1', sourceRefs: ['src-sitemap', 'src-crawl', 'src-gsc'] },
      { id: 'url-docs-start', projectId: 'prj-relayops-us', path: '/docs/getting-started/', title: 'Getting Started', pageType: 'documentation', templateKey: 'docs-article', clusterId: 'clu-integrations', status: 'action_required', priority: 'p2', sourceRefs: ['src-sitemap', 'src-crawl'] },
    ],
    findings: [
      { id: 'fnd-canonical-conflict', projectId: 'prj-relayops-us', lens: 'webtech', ruleId: 'canonical.multiple_targets', title: '渲染后的页面输出多个规范链接目标', severity: 'high', status: 'confirmed', urlIds: ['url-onboarding'], sourceRefs: ['src-crawl'], evidence: { observed: 2, expected: 1 } },
      { id: 'fnd-low-commercial-ctr', projectId: 'prj-relayops-us', lens: 'acquisition', ruleId: 'search.high_impression_low_ctr', title: '商业意图页高曝光、低点击率', severity: 'high', status: 'confirmed', urlIds: ['url-onboarding'], sourceRefs: ['src-gsc'], evidence: { impressions: 68900, ctr: 0.018 } },
      { id: 'fnd-answer-block-gap', projectId: 'prj-relayops-us', lens: 'acquisition', ruleId: 'geo.answer_block_gap', title: '缺少可引用的实施解答模块', severity: 'medium', status: 'confirmed', urlIds: ['url-onboarding'], sourceRefs: ['src-serp', 'src-ai-answers'], evidence: { competitorCoverage: 4, comparedDomains: 5 } },
      { id: 'fnd-blog-coverage-gap', projectId: 'prj-relayops-us', lens: 'acquisition', ruleId: 'content.cluster_coverage_gap', title: '旧文未覆盖自动化决策与人工边界', severity: 'high', status: 'confirmed', urlIds: ['url-blog-automation'], sourceRefs: ['src-gsc', 'src-serp', 'src-ai-answers'], evidence: { aiCitations: 0, fixedQueryCount: 20 } },
      { id: 'fnd-internal-cta-gap', projectId: 'prj-relayops-us', lens: 'acquisition', ruleId: 'content.semantic_cta_missing', title: '博客缺少承接到产品页的语义行动引导', severity: 'medium', status: 'confirmed', urlIds: ['url-blog-automation'], sourceRefs: ['src-crawl'], evidence: { matchingProductLinks: 0 } },
      { id: 'fnd-integration-schema-gap', projectId: 'prj-relayops-us', lens: 'webtech', ruleId: 'schema.integration_steps_missing', title: '集成步骤尚未结构化', severity: 'medium', status: 'confirmed', urlIds: ['url-salesforce'], sourceRefs: ['src-crawl', 'src-serp'], evidence: { visibleSteps: 6, structuredSteps: 0 } },
      { id: 'fnd-competitor-facts-stale', projectId: 'prj-relayops-us', lens: 'diagnosis', ruleId: 'competitor.claim_freshness', title: '竞品事实超过允许的新鲜度窗口', severity: 'high', status: 'confirmed', urlIds: ['url-compare-userpilot'], sourceRefs: ['src-competitor-corpus'], evidence: { ageDays: 143, policyDays: 90 } },
      { id: 'fnd-pricing-message-match', projectId: 'prj-relayops-us', lens: 'landing', ruleId: 'landing.message_match_gap', title: '付费搜索承诺与定价页首屏不一致', severity: 'medium', status: 'confirmed', urlIds: ['url-pricing'], sourceRefs: ['src-ga4', 'src-manual-profile'], evidence: { ctaClickRate: 0.184, formCompletionRate: 0.068 } },
      { id: 'fnd-cannibalization', projectId: 'prj-relayops-us', lens: 'acquisition', ruleId: 'search.intent_cannibalization', title: '同一搜索词的落地 URL 在多页之间切换', severity: 'medium', status: 'confirmed', urlIds: ['url-time-to-value', 'url-blog-automation', 'url-checklist'], sourceRefs: ['src-gsc'], evidence: { competingUrlCount: 3 } },
      { id: 'fnd-security-proof-gap', projectId: 'prj-relayops-us', lens: 'diagnosis', ruleId: 'profile.proof_source_missing', title: '安全与数据处理声明缺少公开证据', severity: 'medium', status: 'unreviewed', urlIds: ['url-security'], sourceRefs: ['src-crawl', 'src-manual-profile'], evidence: { unsupportedClaimCount: 2 } },
      { id: 'fnd-solution-icp-gap', projectId: 'prj-relayops-us', lens: 'diagnosis', ruleId: 'profile.buyer_user_conflated', title: '解决方案页没有区分决策者与使用者', severity: 'high', status: 'confirmed', urlIds: ['url-solution-cs'], sourceRefs: ['src-crawl', 'src-manual-profile'], evidence: { confirmedRoles: 3, rolesRepresented: 1 } },
      { id: 'fnd-download-dead-end', projectId: 'prj-relayops-us', lens: 'landing', ruleId: 'landing.post_conversion_dead_end', title: '资源下载后缺少下一步', severity: 'low', status: 'confirmed', urlIds: ['url-template-plan'], sourceRefs: ['src-ga4'], evidence: { noNextPageRate: 0.72 } },
      { id: 'fnd-docs-orphan', projectId: 'prj-relayops-us', lens: 'webtech', ruleId: 'architecture.orphan_page', title: '快速入门文档只有一条可抓取入链', severity: 'medium', status: 'confirmed', urlIds: ['url-docs-start'], sourceRefs: ['src-crawl'], evidence: { crawlableInboundLinks: 1 } },
      { id: 'fnd-editorial-template-structure', projectId: 'prj-relayops-us', lens: 'webtech', ruleId: 'template.editorial_structure', title: '编辑模板的标题层级与文章结构化数据输出不一致', severity: 'medium', status: 'confirmed', urlIds: ['url-blog-automation', 'url-time-to-value'], sourceRefs: ['src-crawl'], evidence: { templateKey: 'editorial-article', affectedUrls: 2, invalidHeadingTrees: 2, articleSchemaCoverage: '1/2' } },
    ],
    opportunities: [
      { id: 'opp-canonical-fix', projectId: 'prj-relayops-us', lens: 'webtech', title: '修复优先页的规范链接冲突', priority: 'p0', status: 'closed', findingIds: ['fnd-canonical-conflict'], urlIds: ['url-onboarding'], artifactIds: ['art-code-canonical'] },
      { id: 'opp-commercial-intent', projectId: 'prj-relayops-us', lens: 'acquisition', title: '让主商业页同时承接搜索与生成式问答意图', priority: 'p0', status: 'in_execution', findingIds: ['fnd-low-commercial-ctr', 'fnd-answer-block-gap'], urlIds: ['url-onboarding'], artifactIds: ['art-meta-onboarding', 'art-brief-onboarding'] },
      { id: 'opp-blog-refresh', projectId: 'prj-relayops-us', lens: 'acquisition', title: '刷新客户上线自动化英文文章', priority: 'p0', status: 'observing', findingIds: ['fnd-blog-coverage-gap', 'fnd-internal-cta-gap'], urlIds: ['url-blog-automation'], artifactIds: ['art-blog-automation', 'art-publish-automation'] },
      { id: 'opp-integration-structure', projectId: 'prj-relayops-us', lens: 'webtech', title: '结构化 Salesforce 集成步骤', priority: 'p1', status: 'in_execution', findingIds: ['fnd-integration-schema-gap'], urlIds: ['url-salesforce'], artifactIds: ['art-schema-integration'] },
      { id: 'opp-competitor-refresh', projectId: 'prj-relayops-us', lens: 'diagnosis', title: '用已批准的竞品语料刷新对比页', priority: 'p1', status: 'confirmed', findingIds: ['fnd-competitor-facts-stale'], urlIds: ['url-compare-userpilot'], artifactIds: ['art-compare-userpilot'] },
      { id: 'opp-pricing-landing', projectId: 'prj-relayops-us', lens: 'landing', title: '对齐定价落地页的信息、信任证据和演示申请表单', priority: 'p1', status: 'confirmed', findingIds: ['fnd-pricing-message-match'], urlIds: ['url-pricing'], artifactIds: ['art-landing-pricing'] },
      { id: 'opp-cluster-consolidation', projectId: 'prj-relayops-us', lens: 'acquisition', title: '整合价值实现周期主题集群的搜索意图', priority: 'p1', status: 'identified', findingIds: ['fnd-cannibalization'], urlIds: ['url-time-to-value', 'url-blog-automation', 'url-checklist'], artifactIds: [] },
      { id: 'opp-proof-request', projectId: 'prj-relayops-us', lens: 'diagnosis', title: '补充可公开引用的安全证据', priority: 'p2', status: 'identified', findingIds: ['fnd-security-proof-gap'], urlIds: ['url-security'], artifactIds: [] },
      { id: 'opp-solution-icp', projectId: 'prj-relayops-us', lens: 'diagnosis', title: '按决策者、使用者与待完成任务重构客户成功解决方案页', priority: 'p1', status: 'confirmed', findingIds: ['fnd-solution-icp-gap'], urlIds: ['url-solution-cs'], artifactIds: [] },
      { id: 'opp-post-download-cta', projectId: 'prj-relayops-us', lens: 'landing', title: '为模板下载设计可测量的下一步', priority: 'p2', status: 'identified', findingIds: ['fnd-download-dead-end'], urlIds: ['url-template-plan'], artifactIds: [] },
      { id: 'opp-docs-navigation', projectId: 'prj-relayops-us', lens: 'webtech', title: '把快速入门文档接回可抓取的客户上线路径', priority: 'p2', status: 'confirmed', findingIds: ['fnd-docs-orphan'], urlIds: ['url-docs-start'], artifactIds: [] },
      { id: 'opp-editorial-template', projectId: 'prj-relayops-us', targetKind: 'template', templateKey: 'editorial-article', lens: 'webtech', workShape: '修复', title: '统一编辑模板的标题层级与文章结构化数据', priority: 'p1', status: 'confirmed', findingIds: ['fnd-editorial-template-structure'], urlIds: ['url-blog-automation', 'url-time-to-value'], artifactIds: ['art-code-editorial-template'], coverageAndLimitations: ['基于 2026-07-21 渲染抓取快照', '只覆盖当前识别到的 2 个 editorial-article URL'], nextDecision: '审核代码修复方案，并确认 GitHub PR 范围' },
    ],
    keywords: [
      { id: 'kw-onboarding-software', projectId: 'prj-relayops-us', text: 'customer onboarding software', sourceKind: 'competitor_gap', sourceRefs: ['src-serp', 'src-competitor-corpus'], status: 'brief_ready', clusterId: 'clu-onboarding', mappedUrlId: 'url-onboarding', ctaId: 'conv-workflow-review', intent: 'commercial', market: 'US', volume: 2400, difficulty: 31, currentRank: 12.8 },
      { id: 'kw-onboarding-automation', projectId: 'prj-relayops-us', text: 'customer onboarding automation', sourceKind: 'content_gap', sourceRefs: ['src-serp', 'src-competitor-corpus'], status: 'drafting', clusterId: 'clu-onboarding', mappedUrlId: 'url-blog-automation', ctaId: 'conv-workflow-review', intent: 'commercial', market: 'US', volume: 1300, difficulty: 27, currentRank: 15.2 },
      { id: 'kw-best-tools', projectId: 'prj-relayops-us', text: 'best customer onboarding tools', sourceKind: 'competitor_gap', sourceRefs: ['src-serp'], status: 'opportunity', clusterId: 'clu-alternatives', mappedUrlId: 'url-compare-userpilot', ctaId: 'conv-demo-requested', intent: 'commercial', market: 'US', volume: 900, difficulty: 38, currentRank: 24.6 },
      { id: 'kw-how-automate', projectId: 'prj-relayops-us', text: 'how to automate customer onboarding', sourceKind: 'suggest_paa', sourceRefs: ['src-serp'], status: 'drafting', clusterId: 'clu-onboarding', mappedUrlId: 'url-blog-automation', ctaId: 'conv-workflow-review', intent: 'informational', market: 'US', volume: 720, difficulty: 22, currentRank: 18.1 },
      { id: 'kw-onboarding-checklist', projectId: 'prj-relayops-us', text: 'customer onboarding checklist', sourceKind: 'gsc_unexpected', sourceRefs: ['src-gsc'], status: 'monitoring', clusterId: 'clu-onboarding', mappedUrlId: 'url-checklist', ctaId: 'conv-guide-download', intent: 'informational', market: 'US', volume: 1900, difficulty: 34, currentRank: 9.6 },
      { id: 'kw-reduce-ttv', projectId: 'prj-relayops-us', text: 'reduce customer time to value', sourceKind: 'community_voc', sourceRefs: ['src-customer-notes'], status: 'opportunity', clusterId: 'clu-measurement', mappedUrlId: 'url-time-to-value', ctaId: 'conv-workflow-review', intent: 'informational', market: 'US', volume: 480, difficulty: 19, currentRank: 21.1 },
      { id: 'kw-userpilot-alt', projectId: 'prj-relayops-us', text: 'userpilot alternatives', sourceKind: 'competitor_gap', sourceRefs: ['src-serp', 'src-competitor-corpus'], status: 'brief_ready', clusterId: 'clu-alternatives', mappedUrlId: 'url-compare-userpilot', ctaId: 'conv-demo-requested', intent: 'commercial', market: 'US', volume: 1600, difficulty: 29, currentRank: 18.9 },
      { id: 'kw-onboarding-metrics', projectId: 'prj-relayops-us', text: 'customer success onboarding metrics', sourceKind: 'community_voc', sourceRefs: ['src-customer-notes'], status: 'review', clusterId: 'clu-measurement', mappedUrlId: 'url-time-to-value', ctaId: 'conv-guide-download', intent: 'informational', market: 'US', volume: 390, difficulty: 17, currentRank: 13.2 },
      { id: 'kw-ai-assistant', projectId: 'prj-relayops-us', text: 'AI customer onboarding assistant', sourceKind: 'trend_signal', sourceRefs: ['src-serp'], status: 'opportunity', clusterId: 'clu-onboarding', mappedUrlId: null, ctaId: 'conv-workflow-review', intent: 'commercial', market: 'US', volume: 260, difficulty: 12, currentRank: null },
      { id: 'kw-salesforce-workflow', projectId: 'prj-relayops-us', text: 'salesforce customer onboarding workflow', sourceKind: 'content_gap', sourceRefs: ['src-serp'], status: 'brief_ready', clusterId: 'clu-integrations', mappedUrlId: 'url-salesforce', ctaId: 'conv-demo-requested', intent: 'informational', market: 'US', volume: 320, difficulty: 21, currentRank: 10.4 },
      { id: 'kw-plan-template', projectId: 'prj-relayops-us', text: 'customer onboarding plan template', sourceKind: 'gsc_unexpected', sourceRefs: ['src-gsc'], status: 'monitoring', clusterId: 'clu-onboarding', mappedUrlId: 'url-template-plan', ctaId: 'conv-guide-download', intent: 'informational', market: 'US', volume: 1100, difficulty: 26, currentRank: 7.8 },
      { id: 'kw-handoff-checklist', projectId: 'prj-relayops-us', text: 'onboarding handoff checklist', sourceKind: 'manual_csv', sourceRefs: ['src-manual-profile'], status: 'new', clusterId: 'clu-onboarding', mappedUrlId: null, ctaId: 'conv-guide-download', intent: 'informational', market: 'US', volume: 170, difficulty: 8, currentRank: null },
    ],
    clusters: [
      { id: 'clu-brand', projectId: 'prj-relayops-us', slug: 'brand-trust', label: '品牌与信任', role: 'entity_and_trust', roleLabel: '品牌实体与信任', primaryUrlId: 'url-home', supportingUrlIds: ['url-security'], primaryCtaId: 'conv-demo-requested', generativeQueries: ['哪些证据可以支持 RelayOps 的安全声明？'], coverageGap: '安全证据仍待客户确认，暂时不能用于公开引用。' },
      { id: 'clu-onboarding', projectId: 'prj-relayops-us', slug: 'customer-onboarding', label: '客户上线', role: 'commercial_pillar', roleLabel: '商业支柱内容', primaryUrlId: 'url-onboarding', supportingUrlIds: ['url-blog-automation', 'url-checklist', 'url-solution-cs', 'url-template-plan'], primaryCtaId: 'conv-workflow-review', generativeQueries: ['企业软件团队应该如何自动化客户上线？', '客户上线工作流中哪些环节仍应由人工主导？'], coverageGap: '尚缺“智能助手”和“实施风险”两个可引用的解答模块。' },
      { id: 'clu-alternatives', projectId: 'prj-relayops-us', slug: 'alternatives', label: '替代方案', role: 'comparison_hub', roleLabel: '对比内容中心', primaryUrlId: 'url-compare-userpilot', supportingUrlIds: [], primaryCtaId: 'conv-demo-requested', generativeQueries: ['对实施型客户上线而言，哪些工具是 Userpilot 的最佳替代方案？'], coverageGap: '竞品事实已超过新鲜度策略，对比简报暂时被阻断。' },
      { id: 'clu-integrations', projectId: 'prj-relayops-us', slug: 'integrations', label: '集成', role: 'integration_hub', roleLabel: '集成内容中心', primaryUrlId: 'url-salesforce', supportingUrlIds: ['url-docs-start'], primaryCtaId: 'conv-demo-requested', generativeQueries: ['如何把 Salesforce 连接到客户上线工作流？'], coverageGap: '集成步骤可读，但尚未完整结构化。' },
      { id: 'clu-measurement', projectId: 'prj-relayops-us', slug: 'measurement', label: '衡量与价值实现周期', role: 'evidence_reference', roleLabel: '证据参考内容', primaryUrlId: 'url-time-to-value', supportingUrlIds: [], primaryCtaId: 'conv-guide-download', generativeQueries: ['哪些客户上线指标可以预测价值实现周期？'], coverageGap: '多个页面竞争同一搜索词，页面角色需要重新确认。' },
      { id: 'clu-commercial', projectId: 'prj-relayops-us', slug: 'commercial', label: '定价与转化', role: 'commercial_conversion', roleLabel: '商业转化内容', primaryUrlId: 'url-pricing', supportingUrlIds: [], primaryCtaId: 'conv-demo-requested', generativeQueries: ['应该如何评估客户上线软件的定价？'], coverageGap: '付费搜索信息与首屏承诺尚未对齐。' },
    ],
    competitors: [
      { id: 'cmp-userpilot', projectId: 'prj-relayops-us', name: 'Userpilot', domain: 'userpilot.com', relation: 'direct', analysisScope: 'full_domain', status: 'approved', sourceRefs: ['src-competitor-corpus', 'src-serp'], organicOverlapPct: 68, sharedKeywordCount: 1480, aiCitationCount: 8 },
      { id: 'cmp-chameleon', projectId: 'prj-relayops-us', name: 'Chameleon', domain: 'chameleon.io', relation: 'direct', analysisScope: 'full_domain', status: 'approved', sourceRefs: ['src-serp', 'src-ai-answers'], organicOverlapPct: 54, sharedKeywordCount: 972, aiCitationCount: 6 },
      { id: 'cmp-appcues', projectId: 'prj-relayops-us', name: 'Appcues', domain: 'appcues.com', relation: 'direct', analysisScope: 'relevant_keywords', status: 'approved', sourceRefs: ['src-competitor-corpus', 'src-serp'], organicOverlapPct: 49, sharedKeywordCount: 813, aiCitationCount: 7 },
      { id: 'cmp-intercom', projectId: 'prj-relayops-us', name: 'Intercom', domain: 'intercom.com', relation: 'indirect', analysisScope: 'relevant_keywords', status: 'approved', sourceRefs: ['src-serp', 'src-ai-answers'], organicOverlapPct: 42, sharedKeywordCount: 288, aiCitationCount: 11 },
      { id: 'cmp-notion', projectId: 'prj-relayops-us', name: 'Notion Templates', domain: 'notion.so/templates', relation: 'status_quo', analysisScope: 'profile_only', status: 'approved', sourceRefs: ['src-customer-notes'], organicOverlapPct: 18, sharedKeywordCount: 74, aiCitationCount: 3 },
      { id: 'cmp-gainsight', projectId: 'prj-relayops-us', name: 'Gainsight', domain: 'gainsight.com', relation: 'benchmark', analysisScope: 'profile_only', status: 'approved', sourceRefs: ['src-competitor-corpus', 'src-ai-answers'], organicOverlapPct: 33, sharedKeywordCount: 0, aiCitationCount: 13 },
      { id: 'cmp-guidecx', projectId: 'prj-relayops-us', name: 'GuideCX', domain: 'guidecx.com', relation: 'direct', analysisScope: 'full_domain', status: 'candidate', sourceRefs: ['src-serp'], organicOverlapPct: 57, sharedKeywordCount: 691, aiCitationCount: 4 },
      { id: 'cmp-rocketlane', projectId: 'prj-relayops-us', name: 'Rocketlane', domain: 'rocketlane.com', relation: 'direct', analysisScope: 'relevant_keywords', status: 'candidate', sourceRefs: ['src-serp', 'src-customer-notes'], organicOverlapPct: 61, sharedKeywordCount: 744, aiCitationCount: 5 },
      { id: 'cmp-hubspot-blog', projectId: 'prj-relayops-us', name: 'HubSpot Blog', domain: 'blog.hubspot.com', relation: 'publisher', analysisScope: 'excluded', status: 'excluded', sourceRefs: ['src-serp'], organicOverlapPct: 25, sharedKeywordCount: 0, aiCitationCount: 9 },
    ],
    artifacts: [
      { id: 'art-blog-automation', projectId: 'prj-relayops-us', opportunityId: 'opp-blog-refresh', type: 'english_blog_draft', title: 'How to Automate Customer Onboarding Without Losing the Human Touch', status: 'published', revision: 4, targetUrlIds: ['url-blog-automation'], sourceRefs: ['src-customer-notes', 'src-competitor-corpus', 'src-gsc'], requiredGates: ['research', 'seo', 'geo', 'factual', 'human'], passedGates: ['research', 'seo', 'geo', 'factual', 'human'] },
      { id: 'art-brief-onboarding', projectId: 'prj-relayops-us', opportunityId: 'opp-commercial-intent', type: 'content_brief', title: '客户上线软件：用实施信心承接商业意图', status: 'approved', revision: 3, targetUrlIds: ['url-onboarding'], sourceRefs: ['src-manual-profile', 'src-gsc', 'src-competitor-corpus'], requiredGates: ['research', 'seo', 'geo', 'human'], passedGates: ['research', 'seo', 'geo', 'human'] },
      { id: 'art-code-canonical', projectId: 'prj-relayops-us', opportunityId: 'opp-canonical-fix', type: 'code_patch', title: '修复重点 URL 的规范链接冲突', status: 'published', revision: 2, targetUrlIds: ['url-onboarding'], sourceRefs: ['src-crawl'], requiredGates: ['technical', 'human'], passedGates: ['technical', 'human'] },
      { id: 'art-meta-onboarding', projectId: 'prj-relayops-us', opportunityId: 'opp-commercial-intent', type: 'metadata_rewrite', title: '为商业搜索意图重写元数据', status: 'review', revision: 2, targetUrlIds: ['url-onboarding'], sourceRefs: ['src-gsc', 'src-manual-profile'], requiredGates: ['seo', 'factual', 'human'], passedGates: ['seo', 'factual'] },
      { id: 'art-schema-integration', projectId: 'prj-relayops-us', opportunityId: 'opp-integration-structure', type: 'schema_patch', title: '结构化 Salesforce 实施步骤', status: 'in_execution', revision: 1, targetUrlIds: ['url-salesforce'], sourceRefs: ['src-crawl', 'src-serp'], requiredGates: ['technical', 'factual', 'human'], passedGates: ['technical', 'human'] },
      { id: 'art-landing-pricing', projectId: 'prj-relayops-us', opportunityId: 'opp-pricing-landing', type: 'landing_revision', title: '对齐定价信息、信任证据与演示申请表单', status: 'review', revision: 1, targetUrlIds: ['url-pricing'], sourceRefs: ['src-ga4', 'src-manual-profile'], requiredGates: ['factual', 'tracking', 'human'], passedGates: ['factual', 'tracking'] },
      { id: 'art-publish-automation', projectId: 'prj-relayops-us', opportunityId: 'opp-blog-refresh', type: 'publish_receipt', title: '发布自动化指南并开启观察窗口', status: 'published', revision: 1, targetUrlIds: ['url-blog-automation'], sourceRefs: ['src-cms', 'src-ga4'], requiredGates: ['publish', 'tracking'], passedGates: ['publish', 'tracking'] },
      { id: 'art-compare-userpilot', projectId: 'prj-relayops-us', opportunityId: 'opp-competitor-refresh', type: 'comparison_brief', title: 'RelayOps 对比 Userpilot：实施优先的对比简报', status: 'blocked', revision: 1, targetUrlIds: ['url-compare-userpilot'], sourceRefs: ['src-competitor-corpus'], requiredGates: ['research', 'factual', 'legal', 'human'], passedGates: ['research'] },
      { id: 'art-code-editorial-template', projectId: 'prj-relayops-us', opportunityId: 'opp-editorial-template', type: 'code_patch', title: '统一编辑模板的标题层级与文章结构化数据', status: 'review', revision: 1, targetUrlIds: ['url-blog-automation', 'url-time-to-value'], sourceRefs: ['src-crawl'], requiredGates: ['technical', 'factual', 'human'], passedGates: ['technical', 'factual'] },
    ],
    releases: [
      { id: 'rel-blog-automation', projectId: 'prj-relayops-us', artifactId: 'art-blog-automation', kind: 'cms_publish', status: 'published', simulated: true, publishedAt: '2026-06-01T03:06:00.000Z', targetUrlId: 'url-blog-automation', targetUrl: '/blog/customer-onboarding-automation/', rollbackRef: 'RB-2026-06-01-021', observationWindow: { start: '2026-06-01', end: '2026-06-28', days: 28 }, message: '离线场景中已模拟发布英文博客，并建立 UTM 追踪与固定 28 天观察窗口；没有发生真实 CMS 写入。' },
      { id: 'rel-code-canonical', projectId: 'prj-relayops-us', artifactId: 'art-code-canonical', kind: 'git_deploy', status: 'published', simulated: true, publishedAt: '2026-05-30T09:42:00.000Z', targetUrlId: 'url-onboarding', targetUrl: '/customer-onboarding/', rollbackRef: 'RB-2026-05-30-004', observationWindow: { start: '2026-06-01', end: '2026-06-28', days: 28 }, message: '离线场景中已模拟部署规范链接代码修复，并记录后续渲染抓取复查；没有访问真实 GitHub 或部署环境。' },
      { id: 'rel-publish-receipt', projectId: 'prj-relayops-us', artifactId: 'art-publish-automation', kind: 'receipt_archive', status: 'published', simulated: true, publishedAt: '2026-06-01T03:06:00.000Z', targetUrlId: 'url-blog-automation', targetUrl: '/blog/customer-onboarding-automation/', rollbackRef: 'RB-2026-06-01-021', observationWindow: { start: '2026-06-01', end: '2026-06-28', days: 28 }, message: '离线场景模拟发布回执已归档并绑定观察窗口；没有发生真实外部写入。' },
    ],
    results: {
      baselineWindow: { start: '2026-05-01', end: '2026-05-28', days: 28, market: 'US' },
      currentWindow: { start: '2026-06-01', end: '2026-06-28', days: 28, market: 'US' },
      pageObservations: [
        { id: 'obs-page-onboarding', urlId: 'url-onboarding', opportunityIds: ['opp-canonical-fix', 'opp-commercial-intent'], status: 'observed', sourceRefs: ['src-gsc', 'src-ga4'], metrics: { clicks: { before: 1240, current: 1864 }, impressions: { before: 68900, current: 80170 }, conversions: { before: 31, current: 48 }, aiCitations: { before: 1, current: 3 } } },
        { id: 'obs-page-blog', urlId: 'url-blog-automation', opportunityIds: ['opp-blog-refresh'], status: 'observed', sourceRefs: ['src-gsc', 'src-ga4', 'src-ai-answers'], metrics: { clicks: { before: 886, current: 1328 }, impressions: { before: 19400, current: 28600 }, conversions: { before: 12, current: 22 }, aiCitations: { before: 0, current: 3 } } },
        { id: 'obs-page-checklist', urlId: 'url-checklist', opportunityIds: [], status: 'observed', sourceRefs: ['src-gsc', 'src-ga4'], metrics: { clicks: { before: 691, current: 842 }, impressions: { before: 14200, current: 17200 }, conversions: { before: 15, current: 20 }, aiCitations: { before: 1, current: 1 } } },
        { id: 'obs-page-compare', urlId: 'url-compare-userpilot', opportunityIds: ['opp-competitor-refresh'], status: 'observed', sourceRefs: ['src-gsc', 'src-ga4', 'src-ai-answers'], metrics: { clicks: { before: 412, current: 493 }, impressions: { before: 8100, current: 9720 }, conversions: { before: 8, current: 11 }, aiCitations: { before: 1, current: 1 } } },
        { id: 'obs-page-pricing', urlId: 'url-pricing', opportunityIds: [], status: 'insufficient', sourceRefs: ['src-ga4'], metrics: { clicks: { before: 982, current: 1008 }, impressions: { before: 7400, current: 7420 }, conversions: { before: 26, current: 27 }, aiCitations: { before: 0, current: 0 } }, sample: { beforeSessions: 198, currentSessions: 214, note: '当前窗口内的活动渠道组合发生变化，因此不能把本次观察归因于尚未批准的落地页修订。' } },
      ],
      technicalVerifications: [
        { id: 'ver-canonical', opportunityId: 'opp-canonical-fix', findingId: 'fnd-canonical-conflict', status: 'verified', checkedUrlIds: ['url-onboarding'], sourceRefs: ['src-crawl'], checkedAt: '2026-06-02T14:20:00.000Z', metric: '规范链接目标数量', beforeValue: 2, currentValue: 1, expectedValue: 1, assertion: 'canonical_count === 1 && canonical_is_absolute === true' },
        { id: 'ver-integration-schema', opportunityId: 'opp-integration-structure', findingId: 'fnd-integration-schema-gap', status: 'not_resolved', checkedUrlIds: ['url-salesforce'], sourceRefs: ['src-crawl'], checkedAt: '2026-07-21T09:20:00.000Z', metric: '已结构化步骤 / 可见步骤', beforeValue: '0 / 6', currentValue: '3 / 6', expectedValue: '6 / 6', assertion: 'structured_steps === visible_steps' },
        { id: 'ver-docs-navigation', opportunityId: 'opp-docs-navigation', findingId: 'fnd-docs-orphan', status: 'unavailable', checkedUrlIds: ['url-docs-start'], sourceRefs: ['src-crawl'], checkedAt: '2026-07-21T09:20:00.000Z', metric: '可抓取入链数量', beforeValue: 1, currentValue: null, expectedValue: 3, limitation: '目标变更尚未进入可复查的部署快照。', assertion: 'crawlable_inbound_links >= 3' },
      ],
    },
    campaigns: [
      { id: 'cmpg-linkedin-guide', projectId: 'prj-relayops-us', campaign: 'q3-onboarding-guide', source: 'linkedin', medium: 'social', content: 'ops-carousel', landingUrlId: 'url-blog-automation', status: 'observed', sourceRefs: ['src-ga4'], metrics: { sessions: { before: 0, current: 486 }, conversions: { before: 0, current: 9 }, assistedConversions: { before: 0, current: 4 } } },
      { id: 'cmpg-newsletter-guide', projectId: 'prj-relayops-us', campaign: 'q3-onboarding-guide', source: 'newsletter', medium: 'email', content: 'implementation-checklist', landingUrlId: 'url-blog-automation', status: 'observed', sourceRefs: ['src-ga4'], metrics: { sessions: { before: 0, current: 338 }, conversions: { before: 0, current: 12 }, assistedConversions: { before: 0, current: 6 } } },
      { id: 'cmpg-partner-webinar', projectId: 'prj-relayops-us', campaign: 'onboarding-webinar', source: 'partner', medium: 'referral', content: 'followup-email', landingUrlId: 'url-onboarding', status: 'observed', sourceRefs: ['src-ga4'], metrics: { sessions: { before: 212, current: 226 }, conversions: { before: 7, current: 10 }, assistedConversions: { before: 3, current: 5 } } },
      { id: 'cmpg-google-organic', projectId: 'prj-relayops-us', campaign: null, source: 'google', medium: 'organic', content: '/customer-onboarding/', landingUrlId: 'url-onboarding', status: 'observed', sourceRefs: ['src-ga4'], metrics: { sessions: { before: 1680, current: 2314 }, conversions: { before: 31, current: 48 }, assistedConversions: { before: 12, current: 18 } } },
      { id: 'cmpg-chatgpt-referral', projectId: 'prj-relayops-us', campaign: null, source: 'chatgpt.com', medium: 'referral', content: '/blog/customer-onboarding-automation/', landingUrlId: 'url-blog-automation', status: 'observed', sourceRefs: ['src-ga4'], metrics: { sessions: { before: 24, current: 91 }, conversions: { before: 1, current: 5 }, assistedConversions: { before: 0, current: 3 } } },
    ],
    auditEvents: [
      { id: 'evt-snapshot-20260721', projectId: 'prj-relayops-us', type: 'snapshot_created', actorType: 'system', actorId: 'scenario-fixture', at: '2026-07-21T09:30:00.000Z', objectRefs: ['src-sitemap', 'src-crawl', 'src-gsc', 'src-ga4'] },
      { id: 'evt-profile-v4', projectId: 'prj-relayops-us', type: 'profile_confirmed', actorType: 'user', actorId: 'user-wz', at: '2026-07-20T08:40:00.000Z', objectRefs: ['prof-relayops-v4'] },
      { id: 'evt-finding-canonical', projectId: 'prj-relayops-us', type: 'finding_confirmed', actorType: 'user', actorId: 'user-wz', at: '2026-05-29T03:20:00.000Z', objectRefs: ['fnd-canonical-conflict'] },
      { id: 'evt-action-canonical', projectId: 'prj-relayops-us', type: 'action_created', actorType: 'system', actorId: 'gengrowth', at: '2026-05-29T03:20:01.000Z', objectRefs: ['opp-canonical-fix', 'art-code-canonical'] },
      { id: 'evt-blog-r4', projectId: 'prj-relayops-us', type: 'artifact_revised', actorType: 'system', actorId: 'flow-shadow', at: '2026-05-31T11:08:00.000Z', objectRefs: ['art-blog-automation'] },
      { id: 'evt-code-approved', projectId: 'prj-relayops-us', type: 'artifact_approved', actorType: 'user', actorId: 'user-wz', at: '2026-05-29T09:14:00.000Z', objectRefs: ['art-code-canonical'] },
      { id: 'evt-code-published', projectId: 'prj-relayops-us', type: 'change_published', actorType: 'user', actorId: 'engineering', at: '2026-05-30T09:42:00.000Z', objectRefs: ['art-code-canonical', 'url-onboarding'] },
      { id: 'evt-blog-published', projectId: 'prj-relayops-us', type: 'change_published', actorType: 'user', actorId: 'growth-ops', at: '2026-06-01T03:06:00.000Z', objectRefs: ['art-blog-automation', 'art-publish-automation', 'url-blog-automation'] },
      { id: 'evt-canonical-verified', projectId: 'prj-relayops-us', type: 'recheck_completed', actorType: 'system', actorId: 'gengrowth', at: '2026-06-02T14:20:00.000Z', objectRefs: ['ver-canonical', 'opp-canonical-fix'] },
      { id: 'evt-search-observed', projectId: 'prj-relayops-us', type: 'observation_recorded', actorType: 'system', actorId: 'measurement-job', at: '2026-06-29T01:00:00.000Z', objectRefs: ['obs-page-onboarding', 'obs-page-blog'] },
      { id: 'evt-landing-insufficient', projectId: 'prj-relayops-us', type: 'observation_recorded', actorType: 'system', actorId: 'measurement-job', at: '2026-06-29T01:02:00.000Z', objectRefs: ['obs-page-pricing', 'art-landing-pricing'] },
    ],
  };

  dataset.artifacts.push(
    {
      id: 'art-ticket-canonical',
      projectId: 'prj-relayops-us',
      opportunityId: 'opp-canonical-fix',
      type: 'technical_ticket',
      title: 'Technical Ticket：修复 /customer-onboarding/ 的规范链接冲突',
      status: 'approved',
      revision: 1,
      targetUrlIds: ['url-onboarding'],
      sourceRefs: ['src-crawl'],
      requiredGates: ['technical', 'human'],
      passedGates: ['technical', 'human'],
    },
    {
      id: 'art-utm-guide',
      projectId: 'prj-relayops-us',
      opportunityId: 'opp-blog-refresh',
      type: 'utm_plan',
      title: 'UTM Plan：客户上线自动化指南分发追踪方案',
      status: 'approved',
      revision: 1,
      targetUrlIds: ['url-blog-automation'],
      sourceRefs: ['src-ga4', 'src-manual-profile'],
      requiredGates: ['tracking', 'human'],
      passedGates: ['tracking', 'human'],
    }
  );

  dataset.opportunities.forEach(function attachNewArtifactIds(opportunity) {
    if (opportunity.id === 'opp-canonical-fix' && !opportunity.artifactIds.includes('art-ticket-canonical')) {
      opportunity.artifactIds.push('art-ticket-canonical');
    }
    if (opportunity.id === 'opp-blog-refresh' && !opportunity.artifactIds.includes('art-utm-guide')) {
      opportunity.artifactIds.push('art-utm-guide');
    }
  });

  const unavailableMetricPairs = function unavailableMetricPairs() {
    return {
      clicks: { before: null, current: null },
      impressions: { before: null, current: null },
      conversions: { before: null, current: null },
      aiCitations: { before: null, current: null },
    };
  };

  const observationLineage = {
    'obs-page-onboarding': {
      releaseIds: ['rel-code-canonical'],
      campaignIds: ['cmpg-partner-webinar', 'cmpg-google-organic'],
      attributionStatus: 'not_claimed',
      limitation: '该 URL 同时存在代码修复、未发布的内容交付物、自然搜索与活动流量；固定窗口变化只能作为描述性观察，不能归因于其中任一对象。',
    },
    'obs-page-blog': {
      releaseIds: ['rel-blog-automation', 'rel-publish-receipt'],
      campaignIds: ['cmpg-linkedin-guide', 'cmpg-newsletter-guide', 'cmpg-chatgpt-referral'],
      attributionStatus: 'not_claimed',
      limitation: '场景发布、UTM 活动、自然搜索与引荐流量在同一窗口重叠；本记录不把结果归因于单一 Draft、发布或 Campaign。',
    },
    'obs-page-checklist': {
      releaseIds: [],
      campaignIds: [],
      attributionStatus: 'natural_observation_only',
      limitation: '没有绑定场景发布或 UTM Campaign；仅保留同窗口自然表现作为背景对照。',
    },
    'obs-page-compare': {
      releaseIds: [],
      campaignIds: [],
      attributionStatus: 'not_claimed',
      limitation: '对比 Brief 仍被事实与法务门禁阻断，观察值不得解释为该交付物带来的结果。',
    },
    'obs-page-pricing': {
      opportunityIds: ['opp-pricing-landing'],
      releaseIds: [],
      campaignIds: [],
      attributionStatus: 'insufficient',
      limitation: '落地页 Revision 尚未批准或发布，且两个窗口的渠道组合不同；样本不足以进行归因判断。',
    },
  };

  dataset.results.scenarioLabel = scenarioLabel;
  dataset.results.windowId = 'window-us-2026-06-28d';
  dataset.results.measurementPolicy = {
    label: 'Results / 效果结果',
    windowType: 'fixed_before_after',
    attributionMode: 'descriptive_only',
    receiptIsOutcome: false,
    statement: attributionBoundary,
  };
  dataset.results.pageObservations = dataset.results.pageObservations.map(function labelExistingObservation(observation) {
    const lineage = observationLineage[observation.id];
    return {
      scenarioLabel: scenarioLabel,
      windowId: dataset.results.windowId,
      windowCoverage: observation.status === enums.observationStatus.INSUFFICIENT ? 'insufficient' : 'complete',
      relatedArtifactIds: [],
      releaseIds: lineage.releaseIds,
      campaignIds: lineage.campaignIds,
      attributionStatus: lineage.attributionStatus,
      attributionBoundary: lineage.limitation,
      ...observation,
      opportunityIds: lineage.opportunityIds || observation.opportunityIds,
    };
  }).concat([
    {
      id: 'obs-page-home',
      scenarioLabel: scenarioLabel,
      windowId: dataset.results.windowId,
      urlId: 'url-home',
      opportunityIds: [],
      relatedArtifactIds: [],
      releaseIds: [],
      campaignIds: [],
      status: enums.observationStatus.NOT_OBSERVED,
      windowCoverage: 'not_observed',
      attributionStatus: 'not_evaluable',
      sourceRefs: ['src-gsc', 'src-ga4'],
      metrics: unavailableMetricPairs(),
      limitation: '首页未被纳入本次 URL 级固定 28 天结果样本，不能显示 before / current 数值。',
      attributionBoundary: attributionBoundary,
    },
    {
      id: 'obs-page-salesforce',
      scenarioLabel: scenarioLabel,
      windowId: dataset.results.windowId,
      urlId: 'url-salesforce',
      opportunityIds: ['opp-integration-structure'],
      relatedArtifactIds: ['art-schema-integration'],
      releaseIds: [],
      campaignIds: [],
      status: enums.observationStatus.NOT_OBSERVED,
      windowCoverage: 'not_observed',
      attributionStatus: 'not_evaluable',
      sourceRefs: ['src-gsc', 'src-ga4'],
      metrics: unavailableMetricPairs(),
      limitation: 'Schema 修复尚未完成并发布，没有形成可比较的固定窗口结果；技术复查与效果观察必须分开。',
      attributionBoundary: attributionBoundary,
    },
    {
      id: 'obs-page-time-to-value',
      scenarioLabel: scenarioLabel,
      windowId: dataset.results.windowId,
      urlId: 'url-time-to-value',
      opportunityIds: ['opp-cluster-consolidation', 'opp-editorial-template'],
      relatedArtifactIds: ['art-code-editorial-template'],
      releaseIds: [],
      campaignIds: [],
      status: enums.observationStatus.NOT_OBSERVED,
      windowCoverage: 'not_observed',
      attributionStatus: 'not_evaluable',
      sourceRefs: ['src-gsc', 'src-ga4'],
      metrics: unavailableMetricPairs(),
      limitation: '该页存在主题竞争与模板修复提案，但没有已发布 Revision 对应的完整 before / current 窗口。',
      attributionBoundary: attributionBoundary,
    },
    {
      id: 'obs-page-security',
      scenarioLabel: scenarioLabel,
      windowId: dataset.results.windowId,
      urlId: 'url-security',
      opportunityIds: ['opp-proof-request'],
      relatedArtifactIds: [],
      releaseIds: [],
      campaignIds: [],
      status: enums.observationStatus.UNAVAILABLE,
      windowCoverage: 'source_unavailable',
      attributionStatus: 'not_evaluable',
      sourceRefs: ['src-crawl'],
      metrics: unavailableMetricPairs(),
      limitation: '该信任页只有抓取证据，没有 URL 级 GSC / GA4 固定窗口映射，结果不可用。',
      attributionBoundary: attributionBoundary,
    },
    {
      id: 'obs-page-solution-cs',
      scenarioLabel: scenarioLabel,
      windowId: dataset.results.windowId,
      urlId: 'url-solution-cs',
      opportunityIds: ['opp-solution-icp'],
      relatedArtifactIds: [],
      releaseIds: [],
      campaignIds: [],
      status: enums.observationStatus.NOT_OBSERVED,
      windowCoverage: 'not_observed',
      attributionStatus: 'not_evaluable',
      sourceRefs: ['src-gsc', 'src-ga4'],
      metrics: unavailableMetricPairs(),
      limitation: '解决方案页尚未产生客户批准并发布的 Revision，因此未开启结果观察窗口。',
      attributionBoundary: attributionBoundary,
    },
    {
      id: 'obs-page-template-plan',
      scenarioLabel: scenarioLabel,
      windowId: dataset.results.windowId,
      urlId: 'url-template-plan',
      opportunityIds: ['opp-post-download-cta'],
      relatedArtifactIds: [],
      releaseIds: [],
      campaignIds: [],
      status: enums.observationStatus.NOT_OBSERVED,
      windowCoverage: 'not_observed',
      attributionStatus: 'not_evaluable',
      sourceRefs: ['src-gsc', 'src-ga4'],
      metrics: unavailableMetricPairs(),
      limitation: '下载后的下一步仍处于机会阶段，没有发布回执或固定窗口观察。',
      attributionBoundary: attributionBoundary,
    },
    {
      id: 'obs-page-docs-start',
      scenarioLabel: scenarioLabel,
      windowId: dataset.results.windowId,
      urlId: 'url-docs-start',
      opportunityIds: ['opp-docs-navigation'],
      relatedArtifactIds: [],
      releaseIds: [],
      campaignIds: [],
      status: enums.observationStatus.UNAVAILABLE,
      windowCoverage: 'source_unavailable',
      attributionStatus: 'not_evaluable',
      sourceRefs: ['src-crawl'],
      metrics: unavailableMetricPairs(),
      limitation: '目标变更尚未进入部署快照，且文档页没有 URL 级 GSC / GA4 固定窗口映射。',
      attributionBoundary: attributionBoundary,
    },
  ]);

  const releaseLineage = {
    'rel-blog-automation': {
      revisionId: 'rev-art-blog-automation-r4',
      relatedArtifactIds: ['art-blog-automation', 'art-publish-automation', 'art-utm-guide'],
      opportunityIds: ['opp-blog-refresh'],
      observationIds: ['obs-page-blog'],
      campaignIds: ['cmpg-linkedin-guide', 'cmpg-newsletter-guide', 'cmpg-chatgpt-referral'],
    },
    'rel-code-canonical': {
      revisionId: 'rev-art-code-canonical-r2',
      relatedArtifactIds: ['art-ticket-canonical', 'art-code-canonical'],
      opportunityIds: ['opp-canonical-fix'],
      observationIds: ['obs-page-onboarding'],
      campaignIds: [],
    },
    'rel-publish-receipt': {
      revisionId: 'rev-art-publish-automation-r1',
      relatedArtifactIds: ['art-publish-automation', 'art-blog-automation', 'art-utm-guide'],
      opportunityIds: ['opp-blog-refresh'],
      observationIds: ['obs-page-blog'],
      campaignIds: ['cmpg-linkedin-guide', 'cmpg-newsletter-guide'],
    },
  };
  dataset.releases = dataset.releases.map(function labelRelease(release) {
    const lineage = releaseLineage[release.id];
    return {
      scenarioLabel: scenarioLabel,
      ...release,
      revisionId: lineage.revisionId,
      relatedArtifactIds: lineage.relatedArtifactIds,
      opportunityIds: lineage.opportunityIds,
      observationIds: lineage.observationIds,
      campaignIds: lineage.campaignIds,
      attributionStatus: 'not_claimed',
      attributionBoundary: attributionBoundary,
    };
  });

  const campaignLineage = {
    'cmpg-linkedin-guide': {
      utmPlanArtifactId: 'art-utm-guide',
      releaseIds: ['rel-blog-automation'],
      observationIds: ['obs-page-blog'],
      relatedArtifactIds: ['art-utm-guide', 'art-blog-automation'],
      attributionStatus: 'descriptive_utm_observation',
    },
    'cmpg-newsletter-guide': {
      utmPlanArtifactId: 'art-utm-guide',
      releaseIds: ['rel-blog-automation'],
      observationIds: ['obs-page-blog'],
      relatedArtifactIds: ['art-utm-guide', 'art-blog-automation'],
      attributionStatus: 'descriptive_utm_observation',
    },
    'cmpg-partner-webinar': {
      utmPlanArtifactId: null,
      releaseIds: [],
      observationIds: ['obs-page-onboarding'],
      relatedArtifactIds: [],
      attributionStatus: 'descriptive_utm_observation',
    },
    'cmpg-google-organic': {
      utmPlanArtifactId: null,
      releaseIds: ['rel-code-canonical'],
      observationIds: ['obs-page-onboarding'],
      relatedArtifactIds: ['art-code-canonical', 'art-ticket-canonical'],
      attributionStatus: 'untagged_channel_observation',
    },
    'cmpg-chatgpt-referral': {
      utmPlanArtifactId: null,
      releaseIds: ['rel-blog-automation'],
      observationIds: ['obs-page-blog'],
      relatedArtifactIds: ['art-blog-automation'],
      attributionStatus: 'untagged_channel_observation',
    },
  };
  dataset.campaigns = dataset.campaigns.map(function labelCampaign(campaign) {
    const lineage = campaignLineage[campaign.id];
    return {
      scenarioLabel: scenarioLabel,
      ...campaign,
      utmPlanArtifactId: lineage.utmPlanArtifactId,
      releaseIds: lineage.releaseIds,
      observationIds: lineage.observationIds,
      relatedArtifactIds: lineage.relatedArtifactIds,
      attributionStatus: lineage.attributionStatus,
      attributionBoundary: attributionBoundary,
    };
  });

  const artifactLineage = {
    'art-blog-automation': {
      releaseIds: ['rel-blog-automation'],
      observationIds: ['obs-page-blog'],
      campaignIds: ['cmpg-linkedin-guide', 'cmpg-newsletter-guide', 'cmpg-chatgpt-referral'],
    },
    'art-brief-onboarding': {
      releaseIds: [],
      observationIds: ['obs-page-onboarding'],
      campaignIds: [],
    },
    'art-code-canonical': {
      releaseIds: ['rel-code-canonical'],
      observationIds: ['obs-page-onboarding'],
      campaignIds: ['cmpg-google-organic'],
    },
    'art-meta-onboarding': {
      releaseIds: [],
      observationIds: ['obs-page-onboarding'],
      campaignIds: [],
    },
    'art-schema-integration': {
      releaseIds: [],
      observationIds: ['obs-page-salesforce'],
      campaignIds: [],
    },
    'art-landing-pricing': {
      releaseIds: [],
      observationIds: ['obs-page-pricing'],
      campaignIds: [],
    },
    'art-publish-automation': {
      releaseIds: ['rel-publish-receipt', 'rel-blog-automation'],
      observationIds: ['obs-page-blog'],
      campaignIds: ['cmpg-linkedin-guide', 'cmpg-newsletter-guide'],
    },
    'art-compare-userpilot': {
      releaseIds: [],
      observationIds: ['obs-page-compare'],
      campaignIds: [],
    },
    'art-code-editorial-template': {
      releaseIds: [],
      observationIds: ['obs-page-blog', 'obs-page-time-to-value'],
      campaignIds: [],
    },
    'art-ticket-canonical': {
      releaseIds: ['rel-code-canonical'],
      observationIds: ['obs-page-onboarding'],
      campaignIds: ['cmpg-google-organic'],
    },
    'art-utm-guide': {
      releaseIds: ['rel-blog-automation', 'rel-publish-receipt'],
      observationIds: ['obs-page-blog'],
      campaignIds: ['cmpg-linkedin-guide', 'cmpg-newsletter-guide'],
    },
  };

  const artifactDocumentSpecs = {
    'art-ticket-canonical': {
      documentTypeLabel: 'Technical Ticket / 技术工单',
      language: 'zh-CN',
      summary: '离线演示场景中的客户可读 Technical Ticket。目标是让工程团队用一个可验证、可回滚的变更消除 /customer-onboarding/ 渲染结果中的多个 canonical 目标；本工单不是已创建的真实 GitHub Issue 或 Pull Request。',
      blocks: [
        {
          id: 'problem',
          heading: '问题、范围与证据',
          paragraphs: ['渲染抓取快照在同一页面观察到 2 个 canonical 目标，而验收值是唯一且绝对的 1 个目标。影响范围只包含 /customer-onboarding/，不外推到未抓取模板，也不把搜索表现变化解释为该技术问题造成。'],
          keyValues: [
            { label: 'Finding', value: 'fnd-canonical-conflict · canonical.multiple_targets' },
            { label: '证据来源', value: '2026-07-21 渲染抓取场景快照' },
            { label: '目标值', value: 'canonical_count = 1；canonical 为绝对 HTTPS URL' },
          ],
        },
        {
          id: 'implementation',
          heading: '建议实现',
          paragraphs: ['在 commercial-product 模板的 head 生成路径中只保留由规范 URL 解析器输出的 link 元素，并移除页面级重复注入。修改必须保持查询参数规范化策略不变。'],
          code: {
            language: 'html',
            content: '<link rel="canonical" href="https://relayops.com/customer-onboarding/">',
          },
          bullets: ['模板级输出 canonical，页面内容组件不得再次注入', '保留协议、主机名与尾斜杠策略', '不在本工单中更改重定向、hreflang 或站点地图'],
        },
        {
          id: 'acceptance',
          heading: '验收、复查与回滚',
          bullets: ['对目标 URL 重新执行渲染抓取，断言 canonical_count === 1', '确认唯一目标为绝对 HTTPS URL 且返回 200', '抽查同模板其他页面，确认没有删除其合法 canonical', '若出现索引目标漂移，回滚到 RB-2026-05-30-004 对应的场景前一版本'],
          paragraphs: ['Change Receipt / 变更回执只证明场景工作流记录了变更；Results / 效果结果需要独立固定窗口，不能由本工单或回执直接推导。'],
        },
      ],
    },
    'art-code-canonical': {
      documentTypeLabel: 'Code Fix Proposal / 代码修复方案',
      language: 'zh-CN',
      summary: '与 Technical Ticket 配套的离线场景代码修复提案，展示最小实现范围、验证命令和回滚边界。该正文是客户审核材料，不代表真实仓库已创建分支、提交或 PR。',
      blocks: [
        {
          id: 'patch',
          heading: '建议 Patch',
          paragraphs: ['让页面壳层成为 canonical 的唯一写入点，删除 commercial-product 页面组件内重复的 head 注入。以下伪差异用于客户确认预期，不对应任何真实 GitHub 写入。'],
          code: {
            language: 'diff',
            content: '- <Canonical href={page.canonicalUrl} />\n+ {/* canonical is emitted once by the shared page shell */}',
          },
        },
        {
          id: 'validation',
          heading: '技术验证',
          bullets: ['构建目标页面并保存渲染 HTML', '统计 link[rel="canonical"]，期望恰好为 1', '解析 href 并确认 https://relayops.com/customer-onboarding/', '对同模板页面运行回归抓取并保存证据快照'],
          paragraphs: ['技术复查已经在场景数据中达到 2 → 1 的验收值；该复查只验证 HTML 不变量，不证明点击、转化或 AI 引用变化来自本 Patch。'],
        },
        {
          id: 'rollback',
          heading: '发布前置与回滚',
          keyValues: [
            { label: '人工门禁', value: '工程负责人审核模板影响范围' },
            { label: '模拟发布', value: 'rel-code-canonical' },
            { label: '模拟回滚引用', value: 'RB-2026-05-30-004' },
          ],
          paragraphs: ['GitHub 当前在客户连接中标记为尚未接入，因此本 Artifact 不声称创建了真实 PR、合并或部署。'],
        },
      ],
    },
    'art-meta-onboarding': {
      documentTypeLabel: 'Metadata Rewrite / 元数据重写',
      language: 'zh-CN',
      summary: '面向美国英语市场的 Metadata Rewrite 客户审核稿。它把商业搜索意图、实施型客户上线差异与可验证结果写入标题和描述，同时避免未经支持的第一名、保证性收益或竞品比较声明。',
      blocks: [
        {
          id: 'metadata',
          heading: '建议元数据',
          keyValues: [
            { label: 'SEO Title', value: 'Customer Onboarding Software for Implementation Teams | RelayOps' },
            { label: 'Meta Description', value: 'Standardize handoffs, surface implementation risk, and help customer success teams reach value faster with one shared onboarding workflow.' },
            { label: 'Canonical', value: 'https://relayops.com/customer-onboarding/' },
          ],
        },
        {
          id: 'rationale',
          heading: '搜索与 GEO 理由',
          bullets: ['主要 Keyword：customer onboarding software', '保留“implementation teams”以区别只做产品内引导的工具', '描述覆盖 handoff、risk 与 time to value 三个已确认 JTBD', '不写“best”“guaranteed”或未经证据支持的百分比'],
          paragraphs: ['GSC 场景快照显示商业页曝光较高但点击率偏低；这是改写优先级的证据，不是未来点击提升的承诺。'],
        },
        {
          id: 'review',
          heading: '审核与发布条件',
          paragraphs: ['事实与 SEO 门禁已通过，人工审核仍待完成。批准后还需要真实 CMS 或代码发布回执，再建立独立固定窗口；当前 observation 只能作为同 URL 的描述性背景。'],
        },
      ],
    },
    'art-brief-onboarding': {
      documentTypeLabel: 'Content Brief / 内容简报',
      language: 'zh-CN',
      summary: '客户上线软件商业页的 Content Brief。本文档以已确认产品画像、Keyword 来源与竞品场景语料为边界，指导英文页面回答“为什么实施团队需要共享工作流”并承接工作流评估 CTA。',
      blocks: [
        {
          id: 'audience-intent',
          heading: '受众、意图与任务',
          keyValues: [
            { label: '主要受众', value: 'Customer Success VP 与 Customer Success Operations' },
            { label: '主要意图', value: 'commercial investigation · customer onboarding software' },
            { label: '目标 CTA', value: 'Request a workflow review' },
          ],
          paragraphs: ['读者需要判断 RelayOps 是否适合实施型、跨团队客户上线，而不是寻找纯产品内引导。正文应分别写清销售交接、实施风险与价值实现周期。'],
        },
        {
          id: 'outline',
          heading: '建议英文页面结构',
          bullets: ['H1: Customer onboarding software built for implementation work', 'Answer block: what customer onboarding software should coordinate', 'Workflow section: sales-to-implementation handoff', 'Risk section: surface dependencies before escalation', 'Proof section: only customer-approved operational evidence', 'CTA: request a workflow review'],
        },
        {
          id: 'evidence-guardrails',
          heading: '证据与写作边界',
          paragraphs: ['可引用来源包括产品画像 v4、GSC 场景快照和已批准竞品场景语料。不得复制竞品措辞，不得把 Keyword volume 写成客户需求规模，也不得把尚未观察的 Results 当作产品效果。'],
          bullets: ['每个事实声明必须能回到 sourceRefs', '比较性表述只描述已审核能力范围', '保留安全审批角色仍有冲突这一已知缺口'],
        },
      ],
    },
    'art-blog-automation': {
      documentTypeLabel: 'English Blog Draft',
      language: 'en-US',
      summary: 'Scenario-labelled English Blog Draft for customer review. The article explains where automation helps an implementation-led onboarding program and where accountable human judgment must remain. It is not a claim that a real CMS publish occurred.',
      blocks: [
        {
          id: 'article-opening',
          heading: 'How to Automate Customer Onboarding Without Losing the Human Touch',
          paragraphs: [
            'Customer onboarding automation works best when it removes coordination work without removing accountability. Growing customer success teams often start with spreadsheets, email reminders, and a different project plan for every implementation manager. That approach can support a small book of business, but it becomes fragile as volume rises. Context disappears between sales and implementation, owners miss dependencies, and risk becomes visible only after a customer escalates.',
            'A better automation strategy begins with one shared workflow. Capture the commercial promises, desired outcomes, stakeholders, dependencies, and target dates during the sales-to-implementation handoff. Then turn that context into a reusable onboarding plan. Automation can create tasks, remind owners, flag overdue dependencies, and summarize progress. People still decide whether a milestone is truly complete, whether a risk needs executive attention, and whether the customer is ready to move forward.',
          ],
        },
        {
          id: 'article-framework',
          heading: 'Automate the repeatable work, keep judgment visible',
          paragraphs: [
            'Start by mapping the moments that happen in nearly every onboarding journey: handoff, kickoff, technical validation, enablement, launch, and value review. Define the evidence required to complete each milestone. A kickoff should not close because a calendar event ended; it should close when stakeholders, outcomes, responsibilities, and the next decision are recorded. This makes automation dependable because the workflow is based on observable completion criteria.',
            'Use alerts selectively. An alert should help a person make a decision, not create another inbox. Useful signals include a critical dependency that has no owner, a milestone that is late, a customer stakeholder who has stopped responding, or a promised integration that has not passed validation. Route each signal to the role able to act, and include the evidence behind it. Teams should be able to see why an item was flagged and dismiss it with a reason.',
          ],
        },
        {
          id: 'article-measurement',
          heading: 'Measure the operating system, not just activity',
          paragraphs: [
            'Track time to first value, on-time milestone rate, reopened tasks, risk age, and escalation frequency. Compare consistent windows and preserve the workflow version used for each cohort. A faster cycle is encouraging, but it does not prove that one reminder or template caused the improvement. Customer mix, implementation complexity, staffing, and channel changes can all affect the result.',
            'The goal is not a fully autonomous customer journey. The goal is a reliable operating system that gives customers consistent guidance and gives teams more time for discovery, problem solving, and relationship work. Begin with one high-volume onboarding motion, document its decisions, automate the repetitive transitions, and review the exceptions with the people closest to the customer.',
          ],
        },
        {
          id: 'article-cta',
          heading: 'Next step',
          paragraphs: ['Request a workflow review to map your current handoff, milestones, risk signals, and measurement boundaries. This scenario draft uses approved profile and research snapshots; every factual claim still requires customer review before any real publication.'],
        },
      ],
    },
    'art-schema-integration': {
      documentTypeLabel: 'Schema Patch / 结构化数据修复',
      language: 'zh-CN',
      summary: 'Salesforce 集成页的 Schema Patch 客户审核稿。目标是让 6 个可见实施步骤与结构化 HowTo 步骤一一对应；当前场景复查只观察到 3 / 6，因此状态仍是执行中而不是已完成。',
      blocks: [
        {
          id: 'schema',
          heading: '建议 JSON-LD 结构',
          paragraphs: ['name、text 与 position 必须直接来自页面可见步骤，不能为了结构化数据添加用户看不到的声明。以下片段展示字段形状，完整 Patch 需要覆盖 6 个步骤。'],
          code: {
            language: 'json',
            content: '{"@context":"https://schema.org","@type":"HowTo","name":"Connect Salesforce to RelayOps","step":[{"@type":"HowToStep","position":1,"name":"Authorize Salesforce","text":"Connect an approved Salesforce account."}]}',
          },
        },
        {
          id: 'acceptance',
          heading: '验收检查',
          bullets: ['structured_steps === visible_steps === 6', '每个 name 与 text 在可见页面中可找到', 'JSON-LD 可解析且不包含空字段', '渲染抓取与结构化数据测试均保存场景证据'],
          paragraphs: ['当前复查值为 3 / 6，尚未达到验收值。没有发布回执，也没有结果窗口；因此不得显示为已验证。'],
        },
      ],
    },
    'art-landing-pricing': {
      documentTypeLabel: 'Landing Revision Brief / 落地页改版简报',
      language: 'zh-CN',
      summary: '定价页的 Landing Revision Brief，围绕付费搜索信息匹配、信任证据、演示申请表单和追踪边界组织客户审核。它是待审核提案，不是已上线实验，也没有赢家结论。',
      blocks: [
        {
          id: 'above-fold',
          heading: '首屏信息与 CTA',
          keyValues: [
            { label: 'Headline', value: 'Choose an onboarding plan that fits your implementation motion' },
            { label: 'Supporting copy', value: 'Pricing scales with collaboration seats and active onboarding volume.' },
            { label: 'Primary CTA', value: 'Request a tailored workflow review' },
          ],
          paragraphs: ['首屏应延续付费搜索中的“implementation workflow”承诺，不使用无法公开验证的折扣或节省比例。'],
        },
        {
          id: 'trust-form',
          heading: '信任证据与表单',
          bullets: ['只展示已获客户批准的安全和数据处理事实', '表单保留公司邮箱、团队规模、每月上线量与主要目标', '每个字段解释用途，非必要字段不设为必填', '提交后提供明确下一步而非死胡同'],
        },
        {
          id: 'measurement',
          heading: '追踪与归因边界',
          paragraphs: ['记录 CTA 点击、表单开始、表单完成和 demo_requested。当前两个窗口的渠道组合不同，且样本仅 198 → 214 个会话，因此 Results 状态是数据不足，不能把 26 → 27 次转化归因于尚未批准的 Revision。'],
        },
      ],
    },
    'art-publish-automation': {
      documentTypeLabel: 'Publish / Change Receipt / 发布与变更回执',
      language: 'zh-CN',
      summary: '离线演示场景中的 Publish Receipt / Change Receipt。它记录英文文章 Revision 4 的模拟目标、时间、回滚引用和观察窗口；没有真实 CMS 写入、外部链接或邮件发送。',
      blocks: [
        {
          id: 'receipt',
          heading: '模拟发布回执',
          keyValues: [
            { label: 'Receipt', value: 'rel-publish-receipt' },
            { label: '目标 URL', value: '/blog/customer-onboarding-automation/' },
            { label: 'Artifact Revision', value: 'art-blog-automation · Revision 4' },
            { label: '模拟发布时间', value: '2026-06-01 03:06 UTC' },
            { label: '模拟回滚引用', value: 'RB-2026-06-01-021' },
          ],
        },
        {
          id: 'window',
          heading: '观察窗口与 Results',
          paragraphs: ['场景记录建立了 2026-06-01 至 2026-06-28 的固定 28 天窗口，并关联同 URL 的观察与 UTM 行。回执只证明工作流状态和关系被记录；它不等于正向效果，也不证明文章造成观察到的变化。'],
          bullets: ['Observation：obs-page-blog', 'UTM Plan：art-utm-guide', '关联 Campaign：LinkedIn 与 newsletter 两条已标记分发', '未标记的 ChatGPT 引荐只作渠道观察'],
        },
      ],
    },
    'art-utm-guide': {
      documentTypeLabel: 'UTM Plan / UTM 追踪计划',
      language: 'zh-CN',
      summary: '客户上线自动化指南的 UTM Plan。它定义 LinkedIn 与 newsletter 分发的命名、参数、落地页和验收方法；计划与场景 Campaign 行可追溯，但不声称 UTM 标签或某个渠道造成全部转化增量。',
      blocks: [
        {
          id: 'taxonomy',
          heading: '命名规范',
          keyValues: [
            { label: 'utm_campaign', value: 'q3-onboarding-guide' },
            { label: 'utm_source', value: 'linkedin 或 newsletter' },
            { label: 'utm_medium', value: 'social 或 email' },
            { label: 'utm_content', value: 'ops-carousel 或 implementation-checklist' },
          ],
          paragraphs: ['全部使用小写 kebab-case；source 表示发布平台，medium 表示渠道类别，content 区分同一 Campaign 内的素材。禁止把受众姓名、邮箱或其他个人数据放进 UTM。'],
        },
        {
          id: 'examples',
          heading: '客户可复制的场景 URL',
          code: {
            language: 'text',
            content: 'https://relayops.com/blog/customer-onboarding-automation/?utm_source=linkedin&utm_medium=social&utm_campaign=q3-onboarding-guide&utm_content=ops-carousel\nhttps://relayops.com/blog/customer-onboarding-automation/?utm_source=newsletter&utm_medium=email&utm_campaign=q3-onboarding-guide&utm_content=implementation-checklist',
          },
        },
        {
          id: 'qa-attribution',
          heading: 'QA、观察与归因',
          bullets: ['发布前验证 URL 编码、落地页 200 与 GA4 campaign 参数', '分别保留 cmpg-linkedin-guide 与 cmpg-newsletter-guide 稳定 ID', '使用同一固定窗口报告 sessions、direct conversions 与 assisted conversions', '有标签的 Campaign 与自然搜索、引荐流量分开汇总'],
          paragraphs: ['UTM 只支持来源分类，不自动建立因果。Results 中的直接与辅助转化是当前归因模型下的描述性计数；客户组合、其他渠道和同期发布仍可能影响结果。'],
        },
      ],
    },
    'art-compare-userpilot': {
      documentTypeLabel: 'Comparison Brief / 竞品对比简报',
      language: 'zh-CN',
      summary: 'RelayOps 与 Userpilot 的客户审核型 Comparison Brief。它只使用已批准竞品场景语料和搜索结果页快照，区分实施型客户上线与产品内引导，不把未经复核的竞品事实写成公开结论。',
      blocks: [
        {
          id: 'positioning',
          heading: '对比角度',
          paragraphs: ['RelayOps 的建议叙事聚焦跨销售、实施与客户成功团队的客户上线协作；Userpilot 只作为读者可能评估的产品内引导类别参照。不得暗示竞品缺少某项能力，除非新鲜证据直接支持。'],
          bullets: ['读者任务：选择适合实施型客户上线的工作流', 'RelayOps 证据：已确认产品画像与公开页面', '竞品证据：已批准场景语料，当前新鲜度超过策略窗口'],
        },
        {
          id: 'blocker',
          heading: '发布阻断',
          paragraphs: ['竞品事实年龄为 143 天，超过 90 天策略；Legal、Factual 与 Human 门禁尚未通过。因此本 Brief 保持 blocked，不能模拟发布，也不能把同 URL 的观察结果归因于该简报。'],
        },
      ],
    },
    'art-code-editorial-template': {
      documentTypeLabel: 'Template Code Fix / 模板代码修复',
      language: 'zh-CN',
      summary: 'editorial-article 模板的场景代码修复方案，同时覆盖客户上线自动化与价值实现周期两篇文章。它统一标题层级和 Article JSON-LD，但不声称已经创建 GitHub PR 或部署。',
      blocks: [
        {
          id: 'scope',
          heading: '模板范围',
          keyValues: [
            { label: 'Template', value: 'editorial-article' },
            { label: '已识别 URL', value: '/blog/customer-onboarding-automation/；/blog/time-to-value/' },
            { label: 'Finding', value: 'fnd-editorial-template-structure' },
          ],
          paragraphs: ['只覆盖当前抓取快照识别到的 2 个 URL；未抓取页面不在本次结论范围。'],
        },
        {
          id: 'implementation',
          heading: '建议实现与验收',
          code: {
            language: 'text',
            content: 'one visible h1 per article\nheading order must not skip levels\nArticle.mainEntityOfPage must equal the canonical URL',
          },
          bullets: ['每篇文章只有一个可见 H1', 'H2 / H3 层级与内容大纲一致', 'Article headline、dateModified 与 author 来自可见内容', '对两个已识别 URL 保存渲染抓取回归证据'],
          paragraphs: ['GitHub 客户连接仍为尚未接入，客户需先审核代码范围；现阶段没有 Release 或完整 Results 窗口。'],
        },
      ],
    },
  };

  const artifactRevisionHistory = {
    'art-blog-automation': [
      {
        revision: 1,
        createdAt: '2026-05-29T08:30:00.000Z',
        createdBy: 'flow-shadow',
        statusAtCreation: 'draft',
        revisionNote: '建立英文文章骨架与核心搜索意图。',
        changeNote: '从已确认 Finding 生成首个客户可见草稿。',
        snapshotSummary: 'Revision 1 仅包含问题定义、目标读者、核心 Keyword 与初版标题结构，尚未形成完整英文正文。',
        passedGates: ['research'],
      },
      {
        revision: 2,
        createdAt: '2026-05-30T04:20:00.000Z',
        createdBy: 'content-strategist',
        statusAtCreation: 'review',
        revisionNote: '补齐自动化边界与人工判断章节。',
        changeNote: '根据客户画像加入跨团队交接、风险信号与人工责任。',
        snapshotSummary: 'Revision 2 增加销售到实施交接、风险提醒和人工决策边界，但事实核验与 GEO 问答覆盖尚未完成。',
        passedGates: ['research', 'seo'],
      },
      {
        revision: 3,
        createdAt: '2026-05-31T06:45:00.000Z',
        createdBy: 'content-strategist',
        statusAtCreation: 'review',
        revisionNote: '加入衡量边界、解答模块和语义 CTA。',
        changeNote: '补充固定窗口解释、非因果声明与工作流评估 CTA。',
        snapshotSummary: 'Revision 3 已形成完整英文草稿并加入 GEO 解答模块；人工审核门禁仍待完成。',
        passedGates: ['research', 'seo', 'geo', 'factual'],
      },
      {
        revision: 4,
        createdAt: '2026-05-31T11:08:00.000Z',
        createdBy: 'customer-editor',
        statusAtCreation: 'published',
        revisionNote: '完成客户事实审核并收紧效果与归因表述。',
        changeNote: '客户批准可见正文；场景发布与固定观察窗口随后单独记录。',
        snapshotSummary: 'Revision 4 是当前客户可见 English Blog Draft，保留完整正文、事实边界与发布前人工审核记录。',
        passedGates: ['research', 'seo', 'geo', 'factual', 'human'],
        reviewedAt: '2026-05-31T11:08:00.000Z',
        reviewedBy: 'customer-editor',
      },
    ],
    'art-brief-onboarding': [
      {
        revision: 1,
        createdAt: '2026-05-28T07:00:00.000Z',
        createdBy: 'flow-shadow',
        statusAtCreation: 'draft',
        revisionNote: '建立商业页意图与读者任务。',
        changeNote: '从 Keyword、Finding 和产品画像生成初始范围。',
        snapshotSummary: 'Revision 1 记录主要受众、商业搜索意图与目标 CTA，尚未完成页面大纲。',
        passedGates: ['research'],
      },
      {
        revision: 2,
        createdAt: '2026-05-29T05:30:00.000Z',
        createdBy: 'seo-strategist',
        statusAtCreation: 'review',
        revisionNote: '补齐英文页面结构与 GEO 解答块。',
        changeNote: '加入实施型差异、证据要求和语义 CTA。',
        snapshotSummary: 'Revision 2 增加完整大纲、主要 Keyword、GEO 问答和证据引用要求，等待人工审核。',
        passedGates: ['research', 'seo', 'geo'],
      },
      {
        revision: 3,
        createdAt: '2026-05-30T02:15:00.000Z',
        createdBy: 'customer-editor',
        statusAtCreation: 'approved',
        revisionNote: '明确决策者、使用者与禁止声明。',
        changeNote: '客户确认画像边界与比较性写作限制。',
        snapshotSummary: 'Revision 3 是当前已批准 Content Brief，包含受众、意图、页面结构、证据和 CTA。',
        passedGates: ['research', 'seo', 'geo', 'human'],
        reviewedAt: '2026-05-30T02:15:00.000Z',
        reviewedBy: 'customer-editor',
      },
    ],
    'art-code-canonical': [
      {
        revision: 1,
        createdAt: '2026-05-29T04:10:00.000Z',
        createdBy: 'growth-engineer',
        statusAtCreation: 'review',
        revisionNote: '提出移除页面级重复 canonical 注入。',
        changeNote: '建立最小 Patch、模板范围和抓取验收。',
        snapshotSummary: 'Revision 1 包含最小代码差异与 canonical_count 验收，但尚未完成人工工程审核。',
        passedGates: ['technical'],
      },
      {
        revision: 2,
        createdAt: '2026-05-29T09:14:00.000Z',
        createdBy: 'engineering',
        statusAtCreation: 'published',
        revisionNote: '补充同模板回归检查和回滚引用。',
        changeNote: '工程审核通过；模拟发布另由 release 记录。',
        snapshotSummary: 'Revision 2 是当前代码修复方案，包含实现、验证、同模板回归和回滚边界。',
        passedGates: ['technical', 'human'],
        reviewedAt: '2026-05-29T09:14:00.000Z',
        reviewedBy: 'engineering',
      },
    ],
    'art-meta-onboarding': [
      {
        revision: 1,
        createdAt: '2026-07-19T06:40:00.000Z',
        createdBy: 'seo-strategist',
        statusAtCreation: 'draft',
        revisionNote: '建立搜索标题与描述候选。',
        changeNote: '围绕 commercial Keyword 生成首个元数据版本。',
        snapshotSummary: 'Revision 1 提出 SEO Title 与 Meta Description，尚未完成事实核验。',
        passedGates: ['seo'],
      },
      {
        revision: 2,
        createdAt: '2026-07-20T03:25:00.000Z',
        createdBy: 'seo-strategist',
        statusAtCreation: 'review',
        revisionNote: '删除无法支持的领先与保证性措辞。',
        changeNote: '根据产品画像收紧差异化与结果表述。',
        snapshotSummary: 'Revision 2 是当前 Metadata Rewrite，SEO 与事实门禁已通过，等待客户人工审核。',
        passedGates: ['seo', 'factual'],
      },
    ],
    'art-schema-integration': [
      {
        revision: 1,
        createdAt: '2026-07-20T05:10:00.000Z',
        createdBy: 'growth-engineer',
        statusAtCreation: 'in_execution',
        revisionNote: '建立 HowTo JSON-LD 形状与 6 / 6 验收条件。',
        changeNote: '当前实现只覆盖 3 / 6 步骤，保留未解决状态。',
        snapshotSummary: 'Revision 1 包含 JSON-LD 示例、可见内容一致性约束与复查条件；技术复查尚未通过。',
        passedGates: ['technical', 'human'],
      },
    ],
    'art-landing-pricing': [
      {
        revision: 1,
        createdAt: '2026-07-20T06:30:00.000Z',
        createdBy: 'conversion-strategist',
        statusAtCreation: 'review',
        revisionNote: '建立首屏、信任证据、表单和 Tracking 范围。',
        changeNote: '保留样本不足与渠道组合变化的限制。',
        snapshotSummary: 'Revision 1 是待审核 Landing Revision Brief，没有发布或实验赢家结论。',
        passedGates: ['factual', 'tracking'],
      },
    ],
    'art-publish-automation': [
      {
        revision: 1,
        createdAt: '2026-06-01T03:06:00.000Z',
        createdBy: 'growth-ops',
        statusAtCreation: 'published',
        revisionNote: '记录英文文章 Revision 4 的模拟发布与观察窗口。',
        changeNote: '保存模拟目标、时间、回滚引用、UTM 关系和非因果声明。',
        snapshotSummary: 'Revision 1 是场景 Publish / Change Receipt；它不代表真实 CMS 写入，也不等于正向效果。',
        passedGates: ['publish', 'tracking'],
        reviewedAt: '2026-06-01T03:06:00.000Z',
        reviewedBy: 'growth-ops',
      },
    ],
    'art-compare-userpilot': [
      {
        revision: 1,
        createdAt: '2026-07-19T08:20:00.000Z',
        createdBy: 'research-editor',
        statusAtCreation: 'blocked',
        revisionNote: '建立实施型客户上线的对比角度。',
        changeNote: '因竞品事实过期，保留事实、法务与人工门禁阻断。',
        snapshotSummary: 'Revision 1 是被阻断的 Comparison Brief，不可发布或用于归因结论。',
        passedGates: ['research'],
      },
    ],
    'art-code-editorial-template': [
      {
        revision: 1,
        createdAt: '2026-07-21T01:30:00.000Z',
        createdBy: 'growth-engineer',
        statusAtCreation: 'review',
        revisionNote: '统一标题层级与 Article JSON-LD 验收。',
        changeNote: '范围限定为抓取快照识别到的两个 editorial-article URL。',
        snapshotSummary: 'Revision 1 是模板代码修复审核稿；GitHub 尚未接入，没有真实 PR 或部署。',
        passedGates: ['technical', 'factual'],
      },
    ],
    'art-ticket-canonical': [
      {
        revision: 1,
        createdAt: '2026-05-29T03:35:00.000Z',
        createdBy: 'growth-engineer',
        statusAtCreation: 'approved',
        revisionNote: '把 Finding 转为可实施、可验证、可回滚的 Technical Ticket。',
        changeNote: '明确唯一 canonical 验收、模板范围与结果归因边界。',
        snapshotSummary: 'Revision 1 是已批准 Technical Ticket 场景稿；GitHub 尚未接入，因此没有真实 Issue 或 PR。',
        passedGates: ['technical', 'human'],
        reviewedAt: '2026-05-29T09:00:00.000Z',
        reviewedBy: 'engineering',
      },
    ],
    'art-utm-guide': [
      {
        revision: 1,
        createdAt: '2026-05-31T09:40:00.000Z',
        createdBy: 'growth-ops',
        statusAtCreation: 'approved',
        revisionNote: '建立指南分发的 UTM taxonomy、示例和 QA。',
        changeNote: '绑定两条已标记 Campaign，并明确 UTM 不建立因果。',
        snapshotSummary: 'Revision 1 是已批准 UTM Plan 场景稿，覆盖 LinkedIn 与 newsletter 分发。',
        passedGates: ['tracking', 'human'],
        reviewedAt: '2026-05-31T10:10:00.000Z',
        reviewedBy: 'growth-ops',
      },
    ],
  };

  const qualityGateLabelsZh = {
    research: '研究证据',
    seo: 'SEO',
    geo: 'GEO',
    factual: '事实核验',
    human: '人工审核',
    technical: '技术验证',
    tracking: 'Tracking',
    publish: '发布检查',
    legal: 'Legal 审核',
  };

  function revisionDecision(status) {
    if (status === enums.artifactStatus.PUBLISHED) return '场景已发布';
    if (status === enums.artifactStatus.APPROVED) return '已批准';
    if (status === enums.artifactStatus.BLOCKED) return '已阻断';
    if (status === enums.artifactStatus.IN_EXECUTION) return '执行中';
    if (status === enums.artifactStatus.REVIEW) return '待审核';
    return '草稿';
  }

  function historicalDocumentBlocks(artifact, revisionSpec) {
    return [
      {
        id: 'historical-snapshot',
        heading: `Revision ${revisionSpec.revision} 历史正文快照`,
        paragraphs: [
          `${revisionSpec.snapshotSummary} 这是 ${scenarioLabel}中的不可变客户可见快照，不会随着当前 Revision 的正文变化而被覆盖。`,
          `本版本修订摘要：${revisionSpec.revisionNote} 变更说明：${revisionSpec.changeNote}`,
        ],
      },
      {
        id: 'historical-scope',
        heading: '当时的范围、证据与状态',
        keyValues: [
          { label: 'Artifact', value: artifact.id },
          { label: '目标 URL', value: artifact.targetUrlIds.join(' · ') },
          { label: '来源引用', value: artifact.sourceRefs.join(' · ') },
          { label: '当时状态', value: revisionDecision(revisionSpec.statusAtCreation) },
        ],
        paragraphs: ['历史 Revision 用于 Revision Review / 版本审核与审计，不代表当前版本已获相同批准，也不会把后来出现的 Release、Campaign 或 Results 倒填为当时已知事实。'],
      },
    ];
  }

  function buildArtifactDocument(artifact, revisionSpec) {
    const documentSpec = artifactDocumentSpecs[artifact.id];
    const currentRevision = revisionSpec.revision === artifact.revision;
    const revisionId = `rev-${artifact.id}-r${revisionSpec.revision}`;
    const related = artifactLineage[artifact.id];
    const releaseIds = currentRevision ? related.releaseIds.slice() : [];
    const observationIds = currentRevision ? related.observationIds.slice() : [];
    const campaignIds = currentRevision ? related.campaignIds.slice() : [];
    const passedGates = revisionSpec.passedGates.slice();
    const checks = artifact.requiredGates.map(function buildQualityCheck(gate) {
      const passed = passedGates.includes(gate);
      return {
        label: qualityGateLabelsZh[gate] || gate,
        status: passed ? 'passed' : 'pending',
        evidence: passed
          ? `Revision ${revisionSpec.revision} 的 ${qualityGateLabelsZh[gate] || gate}门禁已在场景快照中记录通过。`
          : `Revision ${revisionSpec.revision} 尚未记录 ${qualityGateLabelsZh[gate] || gate}门禁通过。`,
      };
    });
    return {
      id: `doc-${artifact.id}-r${revisionSpec.revision}`,
      artifactId: artifact.id,
      revision: revisionSpec.revision,
      revisionId: revisionId,
      scenarioLabel: scenarioLabel,
      documentTypeLabel: documentSpec.documentTypeLabel,
      language: documentSpec.language,
      title: currentRevision ? artifact.title : `${artifact.title} · Revision ${revisionSpec.revision} 历史快照`,
      summary: currentRevision
        ? documentSpec.summary
        : `${scenarioLabel}中的 ${documentSpec.documentTypeLabel} 历史正文。${revisionSpec.snapshotSummary}`,
      blocks: currentRevision ? documentSpec.blocks : historicalDocumentBlocks(artifact, revisionSpec),
      qa: {
        label: 'QA / 质量检查',
        status: checks.every(function allPassed(check) { return check.status === 'passed'; }) ? 'passed' : 'pending',
        checks: checks,
      },
      revisionReview: {
        label: 'Revision Review / 版本审核',
        revision: revisionSpec.revision,
        decision: revisionDecision(revisionSpec.statusAtCreation),
        reviewedBy: revisionSpec.reviewedBy || '尚未完成人工审核',
        reviewedAt: revisionSpec.reviewedAt || null,
        note: revisionSpec.revisionNote,
      },
      releaseAndResults: {
        label: 'Publish / Change Receipt 与 Results / 效果结果',
        releaseIds: releaseIds,
        observationIds: observationIds,
        campaignIds: campaignIds,
        receiptStatement: releaseIds.length
          ? `关联 ${releaseIds.length} 条场景 Publish / Change Receipt；回执仅证明工作流记录存在。`
          : '本 Revision 没有直接或相关的场景 Publish / Change Receipt。',
        attributionBoundary: attributionBoundary,
      },
    };
  }

  const artifactDocuments = [];
  const artifactRevisions = [];
  dataset.artifacts.forEach(function buildArtifactHistory(artifact) {
    const history = artifactRevisionHistory[artifact.id];
    history.forEach(function appendRevision(revisionSpec) {
      const document = buildArtifactDocument(artifact, revisionSpec);
      artifactDocuments.push(document);
      artifactRevisions.push({
        id: `rev-${artifact.id}-r${revisionSpec.revision}`,
        artifactId: artifact.id,
        revision: revisionSpec.revision,
        documentId: document.id,
        scenarioLabel: scenarioLabel,
        createdAt: revisionSpec.createdAt,
        createdBy: revisionSpec.createdBy,
        statusAtCreation: revisionSpec.statusAtCreation,
        revisionNote: revisionSpec.revisionNote,
        changeNote: revisionSpec.changeNote,
        requiredGates: artifact.requiredGates.slice(),
        passedGates: revisionSpec.passedGates.slice(),
        targetUrlIds: artifact.targetUrlIds.slice(),
        sourceRefs: artifact.sourceRefs.slice(),
      });
    });
  });

  dataset.artifacts = dataset.artifacts.map(function attachArtifactCanon(artifact) {
    const opportunity = dataset.opportunities.find(function findOpportunity(item) { return item.id === artifact.opportunityId; });
    const lineage = artifactLineage[artifact.id];
    const revisionIds = artifactRevisionHistory[artifact.id].map(function revisionId(item) {
      return `rev-${artifact.id}-r${item.revision}`;
    });
    return {
      scenarioLabel: scenarioLabel,
      ...artifact,
      documentId: `doc-${artifact.id}-r${artifact.revision}`,
      revisionIds: revisionIds,
      lineage: {
        findingIds: opportunity ? opportunity.findingIds.slice() : [],
        releaseIds: lineage.releaseIds.slice(),
        observationIds: lineage.observationIds.slice(),
        campaignIds: lineage.campaignIds.slice(),
        attributionStatus: 'not_claimed',
        attributionBoundary: attributionBoundary,
      },
    };
  });
  dataset.artifactDocuments = artifactDocuments;
  dataset.artifactRevisions = artifactRevisions;

  function sourceNames(sourceRefs) {
    return sourceRefs.map(function resolveSourceName(sourceId) {
      const source = dataset.dataSources.find(function findSource(item) { return item.id === sourceId; });
      return source ? source.name : sourceId;
    });
  }

  const keywordIntakeLabels = {
    competitor_gap: '竞品 Keyword Gap 场景分析',
    content_gap: '内容覆盖缺口场景分析',
    suggest_paa: 'Seed + Suggest / PAA 场景采样',
    community_voc: '客户访谈摘要 / VOC',
    trend_signal: '搜索趋势场景信号',
    gsc_unexpected: 'GSC 场景快照中的意外查询',
    manual_csv: '客户手动 / CSV 入库',
    manual: '客户手动入库',
  };

  dataset.dataSources = dataset.dataSources.map(function labelSource(source) {
    return { scenarioLabel: scenarioLabel, ...source };
  });
  dataset.urls = dataset.urls.map(function labelUrl(url) {
    const observation = dataset.results.pageObservations.find(function findObservation(item) { return item.urlId === url.id; });
    return {
      scenarioLabel: scenarioLabel,
      ...url,
      observationId: observation ? observation.id : null,
      observationStatus: observation ? observation.status : enums.observationStatus.NOT_OBSERVED,
    };
  });
  dataset.findings = dataset.findings.map(function labelFinding(finding) {
    return { scenarioLabel: scenarioLabel, ...finding };
  });
  dataset.opportunities = dataset.opportunities.map(function labelOpportunity(opportunity) {
    return { scenarioLabel: scenarioLabel, ...opportunity };
  });
  dataset.keywords = dataset.keywords.map(function attachKeywordProvenance(keyword) {
    return {
      scenarioLabel: scenarioLabel,
      ...keyword,
      provenance: {
        label: 'Keyword 来源 / 入库路径',
        intakePath: keywordIntakeLabels[keyword.sourceKind] || keyword.sourceKind,
        sourceRefs: keyword.sourceRefs.slice(),
        sourceNames: sourceNames(keyword.sourceRefs),
        statement: `该 Keyword 通过“${keywordIntakeLabels[keyword.sourceKind] || keyword.sourceKind}”进入离线场景库；volume、difficulty 与 rank 是场景快照值，不是实时第三方查询。`,
      },
    };
  });
  dataset.clusters = dataset.clusters.map(function labelCluster(cluster) {
    return { scenarioLabel: scenarioLabel, ...cluster };
  });
  dataset.competitors = dataset.competitors.map(function attachCompetitorProvenance(competitor) {
    const reviewState = competitor.status === enums.competitorStatus.APPROVED
      ? '已由场景客户审核纳入分析范围'
      : competitor.status === enums.competitorStatus.EXCLUDED
        ? '已由场景客户审核排除'
        : '仅为候选，尚未参与正式差距结论';
    return {
      scenarioLabel: scenarioLabel,
      ...competitor,
      provenance: {
        label: 'Competitor 发现路径 / 系统证据',
        discoveryPath: sourceNames(competitor.sourceRefs).join(' + '),
        sourceRefs: competitor.sourceRefs.slice(),
        sourceNames: sourceNames(competitor.sourceRefs),
        reviewState: reviewState,
        statement: `${competitor.name} 来自 ${sourceNames(competitor.sourceRefs).join('、')}；${reviewState}。重叠率、共享 Keyword 与 AI 引用均为离线场景快照。`,
      },
    };
  });

  dataset.results.pageObservations = dataset.results.pageObservations.map(function attachObservationArtifacts(observation) {
    const relatedArtifactIds = Object.keys(artifactLineage).filter(function referencesObservation(artifactId) {
      return artifactLineage[artifactId].observationIds.includes(observation.id);
    });
    return {
      ...observation,
      relatedArtifactIds: relatedArtifactIds,
      attributionBoundary: observation.attributionBoundary || observation.limitation || attributionBoundary,
    };
  });
  dataset.results.technicalVerifications = dataset.results.technicalVerifications.map(function attachVerificationLineage(verification) {
    const lineageByVerification = {
      'ver-canonical': {
        relatedArtifactIds: ['art-ticket-canonical', 'art-code-canonical'],
        releaseIds: ['rel-code-canonical'],
      },
      'ver-integration-schema': {
        relatedArtifactIds: ['art-schema-integration'],
        releaseIds: [],
      },
      'ver-docs-navigation': {
        relatedArtifactIds: [],
        releaseIds: [],
      },
    };
    const lineage = lineageByVerification[verification.id];
    return {
      scenarioLabel: scenarioLabel,
      ...verification,
      relatedArtifactIds: lineage.relatedArtifactIds,
      releaseIds: lineage.releaseIds,
      attributionStatus: 'technical_acceptance_only',
      attributionBoundary: '技术复查只验证明确的验收值，不等于业务 Results，也不证明任何搜索、引用或转化变化。',
    };
  });
  dataset.auditEvents = dataset.auditEvents.map(function labelAuditEvent(event) {
    return { scenarioLabel: scenarioLabel, ...event };
  });
  dataset.project = { scenarioLabel: scenarioLabel, ...dataset.project };

  function countBy(items, keyOrSelector) {
    const selector = typeof keyOrSelector === 'function' ? keyOrSelector : function selectKey(item) { return item[keyOrSelector]; };
    return items.reduce(function reduceCounts(counts, item) {
      const key = selector(item);
      if (key !== null && key !== undefined && key !== '') counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {});
  }

  function relationIndex(items, relationKey) {
    return items.reduce(function reduceRelations(index, item) {
      const ids = Array.isArray(item[relationKey]) ? item[relationKey] : [];
      ids.forEach(function addRelation(id) {
        if (!index[id]) index[id] = [];
        index[id].push(item.id);
      });
      return index;
    }, {});
  }

  function lensCounts(data) {
    const counts = Object.keys(labelsZh.lens).reduce(function seed(result, lens) {
      result[lens] = 0;
      return result;
    }, {});
    data.opportunities.forEach(function countOpportunity(opportunity) {
      if (opportunity.status !== enums.opportunityStatus.DISMISSED) counts[opportunity.lens] += 1;
    });
    return counts;
  }

  function urlOpportunityCounts(data) {
    const opportunityIdsByUrl = relationIndex(
      data.opportunities.filter(function keepOpportunity(opportunity) { return opportunity.status !== enums.opportunityStatus.DISMISSED; }),
      'urlIds'
    );
    const opportunityById = data.opportunities.reduce(function indexOpportunity(index, opportunity) {
      index[opportunity.id] = opportunity;
      return index;
    }, {});
    return data.urls.map(function summarizeUrl(url) {
      const ids = opportunityIdsByUrl[url.id] || [];
      const related = ids.map(function getOpportunity(id) { return opportunityById[id]; });
      return {
        urlId: url.id,
        total: related.length,
        byLens: countBy(related, 'lens'),
        byStatus: countBy(related, 'status'),
      };
    });
  }

  function keywordSourceCounts(data) {
    return countBy(data.keywords, 'sourceKind');
  }

  function keywordStatusCounts(data) {
    return countBy(data.keywords, 'status');
  }

  function competitorStatusCounts(data) {
    return countBy(data.competitors, 'status');
  }

  function workQueueStatusCounts(data) {
    return countBy(data.artifacts, 'status');
  }

  function artifactTypeCounts(data) {
    return countBy(data.artifacts, 'type');
  }

  function observationStatusCounts(data) {
    return countBy(data.results.pageObservations, 'status');
  }

  function releaseStatusCounts(data) {
    return countBy(data.releases, 'status');
  }

  function campaignStatusCounts(data) {
    return countBy(data.campaigns, 'status');
  }

  function inventoryCounts(data) {
    return {
      urls: data.urls.length,
      findings: data.findings.length,
      opportunities: data.opportunities.length,
      keywords: data.keywords.length,
      clusters: data.clusters.length,
      competitors: data.competitors.length,
      artifacts: data.artifacts.length,
      artifactDocuments: data.artifactDocuments.length,
      artifactRevisions: data.artifactRevisions.length,
      releases: data.releases.length,
      pageObservations: data.results.pageObservations.length,
      technicalVerifications: data.results.technicalVerifications.length,
      campaigns: data.campaigns.length,
      taggedCampaigns: data.campaigns.filter(function tagged(item) { return Boolean(item.campaign); }).length,
      customerManagedSources: data.dataSources.filter(function customerSource(item) {
        return item.audienceVisibility === enums.sourceVisibility.CUSTOMER;
      }).length,
      availableCustomerConnections: data.dataSources.filter(function availableCustomerSource(item) {
        return item.audienceVisibility === enums.sourceVisibility.CUSTOMER
          && item.connectionState === 'available';
      }).length,
      fixedWindowObservedUrls: data.results.pageObservations.filter(function fixedWindow(item) {
        return item.windowCoverage === 'complete' || item.windowCoverage === 'insufficient';
      }).length,
      unavailableOrNotObservedUrls: data.results.pageObservations.filter(function noWindow(item) {
        return item.status === enums.observationStatus.UNAVAILABLE || item.status === enums.observationStatus.NOT_OBSERVED;
      }).length,
    };
  }

  function aggregateMetricPairs(records) {
    return records.reduce(function reduceMetrics(totals, record) {
      Object.keys(record.metrics || {}).forEach(function addMetric(metricName) {
        const pair = record.metrics[metricName];
        if (!pair || !Number.isFinite(pair.before) || !Number.isFinite(pair.current)) return;
        if (!totals[metricName]) totals[metricName] = { before: 0, current: 0, coverage: 0 };
        totals[metricName].before += pair.before;
        totals[metricName].current += pair.current;
        totals[metricName].coverage += 1;
      });
      return totals;
    }, {});
  }

  function addDeltas(totals) {
    return Object.keys(totals).reduce(function withDelta(result, metricName) {
      const item = totals[metricName];
      result[metricName] = {
        before: item.before,
        current: item.current,
        delta: item.current - item.before,
        coverage: item.coverage,
      };
      return result;
    }, {});
  }

  function beforeCurrentResultTotals(data) {
    return addDeltas(aggregateMetricPairs(data.results.pageObservations));
  }

  function utmTotals(data) {
    const tagged = data.campaigns.filter(function hasUtmCampaign(campaign) { return Boolean(campaign.campaign); });
    const untagged = data.campaigns.filter(function lacksUtmCampaign(campaign) { return !campaign.campaign; });
    return {
      tagged: addDeltas(aggregateMetricPairs(tagged)),
      untagged: addDeltas(aggregateMetricPairs(untagged)),
      allObserved: addDeltas(aggregateMetricPairs(data.campaigns)),
    };
  }

  function sourceFreshness(data) {
    const snapshotTime = Date.parse(data.snapshotAt);
    return data.dataSources.map(function summarizeSource(source) {
      if (source.status === enums.sourceStatus.UNAVAILABLE || !source.observedAt) {
        return { sourceId: source.id, ageHours: null, freshness: 'unavailable', status: source.status };
      }
      const ageHours = Math.max(0, (snapshotTime - Date.parse(source.observedAt)) / 3600000);
      const freshness = ageHours <= source.freshnessSlaHours
        ? 'fresh'
        : ageHours <= source.freshnessSlaHours * 2
          ? 'aging'
          : 'stale';
      return {
        sourceId: source.id,
        ageHours: Math.round(ageHours * 10) / 10,
        freshness: freshness,
        status: source.status,
      };
    });
  }

  function derive(data) {
    return {
      lensCounts: lensCounts(data),
      urlOpportunityCounts: urlOpportunityCounts(data),
      keywordSourceCounts: keywordSourceCounts(data),
      keywordStatusCounts: keywordStatusCounts(data),
      competitorStatusCounts: competitorStatusCounts(data),
      workQueueStatusCounts: workQueueStatusCounts(data),
      artifactTypeCounts: artifactTypeCounts(data),
      observationStatusCounts: observationStatusCounts(data),
      releaseStatusCounts: releaseStatusCounts(data),
      campaignStatusCounts: campaignStatusCounts(data),
      inventoryCounts: inventoryCounts(data),
      resultTotals: beforeCurrentResultTotals(data),
      utmTotals: utmTotals(data),
      sourceFreshness: sourceFreshness(data),
    };
  }

  function deepFreeze(value) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function') || Object.isFrozen(value)) return value;
    if (typeof value === 'function') return Object.freeze(value);
    Object.getOwnPropertyNames(value).forEach(function freezeChild(name) { deepFreeze(value[name]); });
    return Object.freeze(value);
  }

  const selectors = {
    countBy: countBy,
    relationIndex: relationIndex,
    lensCounts: lensCounts,
    urlOpportunityCounts: urlOpportunityCounts,
    keywordSourceCounts: keywordSourceCounts,
    keywordStatusCounts: keywordStatusCounts,
    competitorStatusCounts: competitorStatusCounts,
    workQueueStatusCounts: workQueueStatusCounts,
    artifactTypeCounts: artifactTypeCounts,
    observationStatusCounts: observationStatusCounts,
    releaseStatusCounts: releaseStatusCounts,
    campaignStatusCounts: campaignStatusCounts,
    inventoryCounts: inventoryCounts,
    beforeCurrentResultTotals: beforeCurrentResultTotals,
    utmTotals: utmTotals,
    sourceFreshness: sourceFreshness,
    derive: derive,
  };

  global.GenGrowthWorkspace = deepFreeze({
    schemaVersion: dataset.schemaVersion,
    datasetKind: dataset.datasetKind,
    snapshotAt: dataset.snapshotAt,
    scenarioLabel: scenarioLabel,
    scenarioNotice: dataset.scenarioNotice,
    attributionBoundary: attributionBoundary,
    enums: enums,
    labelsZh: labelsZh,
    project: dataset.project,
    profile: dataset.profile,
    profileVersionPolicy: dataset.profileVersionPolicy,
    profileVersions: dataset.profileVersions,
    dataSources: dataset.dataSources,
    urls: dataset.urls,
    findings: dataset.findings,
    opportunities: dataset.opportunities,
    keywords: dataset.keywords,
    clusters: dataset.clusters,
    competitors: dataset.competitors,
    artifacts: dataset.artifacts,
    artifactDocuments: dataset.artifactDocuments,
    artifactRevisions: dataset.artifactRevisions,
    releases: dataset.releases,
    results: dataset.results,
    campaigns: dataset.campaigns,
    auditEvents: dataset.auditEvents,
    selectors: selectors,
    derived: derive(dataset),
  });
}(window));
