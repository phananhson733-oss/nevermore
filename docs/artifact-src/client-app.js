(function startClientWorkspace() {
  'use strict';

  const seed = window.GenGrowthWorkspace;
  const app = document.querySelector('#app');

  if (!seed || !app) {
    document.body.innerHTML = '<main class="boot-error"><h1>工作区加载失败</h1><p>缺少 workspace-data.js 或页面挂载点。</p></main>';
    return;
  }

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const workspace = {
    ...clone({
      project: seed.project,
      scenarioNotice: seed.scenarioNotice,
      profile: seed.profile,
      dataSources: seed.dataSources,
      urls: seed.urls,
      findings: seed.findings,
      opportunities: seed.opportunities,
      keywords: seed.keywords,
      clusters: seed.clusters,
      competitors: seed.competitors,
      artifacts: seed.artifacts,
      artifactDocuments: seed.artifactDocuments || [],
      releases: seed.releases,
      results: seed.results,
      campaigns: seed.campaigns,
      auditEvents: seed.auditEvents,
    }),
    shareReceipts: [],
  };
  workspace.profileVersions = clone(seed.profileVersions || seed.profile?.versionHistory || [{
    id: `${workspace.profile.id}-v${workspace.profile.version}`,
    version: workspace.profile.version,
    confirmedAt: workspace.profile.confirmedAt,
    confirmedBy: workspace.profile.confirmedBy || 'customer-user',
    snapshot: clone(workspace.profile),
  }]);
  workspace.artifactRevisions = clone(seed.artifactRevisions || workspace.artifacts.map((item) => ({
    id: `${item.id}-r${item.revision}`,
    artifactId: item.id,
    revision: item.revision,
    createdAt: item.updatedAt || item.approvedAt || seed.snapshotAt,
    createdBy: item.approvedBy || 'system',
    title: item.title,
    type: item.type,
    statusAtCreation: item.status,
    revisionNote: item.revisionNote || '初始客户可见版本',
    changeNote: item.changeNote || '由当前场景数据初始化。',
    requiredGates: clone(item.requiredGates),
    passedGates: clone(item.passedGates),
    targetUrlIds: clone(item.targetUrlIds),
    sourceRefs: clone(item.sourceRefs),
  })));

  const labels = seed.labelsZh;
  const allowedRoutes = ['overview', 'growth-map', 'execution', 'results'];
  const routeFromHash = () => {
    const value = window.location.hash.replace(/^#\/?/, '').split('?')[0];
    return allowedRoutes.includes(value) ? value : 'overview';
  };
  const initialSelections = {
    artifact: workspace.artifacts.find((item) => item.type === 'english_blog_draft')?.id || workspace.artifacts[0]?.id,
    page: workspace.urls.find((item) => item.status === 'action_required')?.id || workspace.urls.find((item) => item.priority === 'p0')?.id || workspace.urls[0]?.id,
    cluster: workspace.clusters.find((cluster) => workspace.opportunities.some((item) => item.urlIds.some((urlId) => workspace.urls.find((url) => url.id === urlId)?.clusterId === cluster.id) && !['closed', 'dismissed'].includes(item.status)))?.id || workspace.clusters[0]?.id,
    opportunity: workspace.opportunities.find((item) => item.priority === 'p0' && !['closed', 'dismissed'].includes(item.status))?.id || workspace.opportunities[0]?.id,
    keyword: workspace.keywords[0]?.id,
    competitor: workspace.competitors.find((item) => item.status === 'candidate')?.id || workspace.competitors[0]?.id,
  };
  const defaultResultWindowId = workspace.results.windowId
    || `${workspace.results.currentWindow.start}_${workspace.results.currentWindow.end}`;
  const freshUrlFlags = () => ({
    mapTab: false,
    pageView: false,
    pageNumber: { pages: false, keywords: false, competitors: false },
    selection: { pages: false, keywords: false, competitors: false },
    search: { pages: false, keywords: false, competitors: false },
    status: { pages: false, keywords: false, competitors: false },
    keywordSource: false,
    pageType: false,
    pageTemplate: false,
    pageCluster: false,
    pageStatus: false,
    pageLens: false,
    pageRowsExpanded: false,
    artifactFilter: false,
    artifactSelection: false,
    resultTab: false,
    resultWindow: false,
  });

  const state = {
    route: routeFromHash(),
    mapTab: 'pages',
    pageView: 'url',
    pageTypeFilter: 'all',
    pageTemplateFilter: 'all',
    pageClusterFilter: 'all',
    pageStatusFilter: 'all',
    pageLensFilter: 'all',
    pageRowsExpanded: false,
    resultTab: 'overview',
    resultWindowId: defaultResultWindowId,
    artifactFilter: 'all',
    selectedArtifactId: initialSelections.artifact,
    selectedPageId: initialSelections.page,
    selectedClusterId: initialSelections.cluster,
    selectedOpportunityId: initialSelections.opportunity,
    selectedKeywordId: initialSelections.keyword,
    selectedCompetitorId: initialSelections.competitor,
    keywordSource: 'all',
    searches: { pages: '', keywords: '', competitors: '' },
    statusFilters: { pages: 'all', keywords: 'all', competitors: 'all' },
    pages: { pages: 1, keywords: 1, competitors: 1 },
    pageSize: 6,
    overlay: null,
    overlayPayload: null,
    evidenceTab: 'summary',
    mobileNav: false,
    lastFocus: null,
    urlFlags: freshUrlFlags(),
  };
  const overlayPayloadCache = new Map();

  const icon = (name) => {
    const paths = {
      home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10.5V20h13v-9.5M9.5 20v-6h5v6"/>',
      map: '<path d="m3.5 6 5-2 7 2 5-2v14l-5 2-7-2-5 2z"/><path d="M8.5 4v14M15.5 6v14"/>',
      execute: '<path d="M14.6 6.2a4 4 0 0 0-5.1-4.7l2.2 2.2-2.8 2.8-2.2-2.2a4 4 0 0 0 4.7 5.1l-6.9 6.9a2.2 2.2 0 1 0 3.1 3.1l6.9-6.9a4 4 0 0 0 5.1-4.7L17.4 10l-2.8-2.8 2.2-2.2"/>',
      results: '<path d="M4 19V9M10 19V5M16 19v-7M22 19V2"/>',
      search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/>',
      arrow: '<path d="m9 18 6-6-6-6"/>',
      close: '<path d="m6 6 12 12M18 6 6 18"/>',
      sync: '<path d="M20 7h-5V2"/><path d="M20 7a8 8 0 1 0 1 8"/>',
      link: '<path d="M10 13a5 5 0 0 0 7.5.5l2-2a5 5 0 0 0-7-7l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.5-.5l-2 2a5 5 0 0 0 7 7l1.1-1.1"/>',
      check: '<path d="m5 12 4 4L19 6"/>',
      menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
      globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/>',
      external: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h6"/>',
    };
    return `<svg class="ui-icon" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.arrow}</svg>`;
  };

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
  const byId = (items, id) => items.find((item) => item.id === id);
  const compact = (number) => new Intl.NumberFormat('en-US', { notation: number >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(number || 0);
  const metricValue = (value, unavailable = '未连接') => value === null || value === undefined || Number.isNaN(value) ? unavailable : compact(value);
  const percent = (before, current) => before ? `${current >= before ? '+' : ''}${Math.round(((current - before) / before) * 100)}%` : current ? '新增' : '—';
  const dateZh = (value) => value ? new Intl.DateTimeFormat('zh-CN', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(value)) : '—';
  const statusLabel = (group, value) => labels[group]?.[value] || value;
  const toneFor = (status) => ['approved', 'published', 'verified', 'observed', 'monitoring'].includes(status)
    ? 'success'
    : ['review', 'candidate', 'action_required', 'not_resolved', 'blocked', 'needs_data'].includes(status)
      ? 'warning'
      : 'neutral';
  const badge = (text, tone = 'neutral') => `<span class="badge badge--${tone}">${escapeHtml(text)}</span>`;
  const sourceName = (id) => byId(workspace.dataSources, id)?.name || id;
  const sourceFreshness = (sourceRefs = []) => {
    const observed = sourceRefs.map((id) => byId(workspace.dataSources, id)).filter((source) => source?.observedAt).sort((a, b) => new Date(a.observedAt) - new Date(b.observedAt));
    if (!observed.length) return { label: '不可用', observedAt: null };
    return { label: dateZh(observed[0].observedAt), observedAt: observed[0].observedAt };
  };
  const urlName = (id) => byId(workspace.urls, id)?.path || id;
  const artifactTypeLabels = {
    english_blog_draft: 'English Blog',
    content_brief: '内容 Brief',
    code_patch: '代码修复',
    metadata_rewrite: 'Metadata 重写',
    schema_patch: 'Schema 修复',
    technical_ticket: 'Technical Ticket / 技术工单',
    landing_revision: 'Landing 页面改版',
    utm_plan: 'UTM Plan / 追踪方案',
    publish_receipt: '发布回执',
    comparison_brief: '竞品对比 Brief',
  };
  const connectionStateLabels = {
    connected: '已连接',
    collecting: '采集中',
    available: '演示数据可用',
    unavailable: '尚未接入',
    failed: '连接失败',
  };
  const artifactOwners = {
    english_blog_draft: '内容策略师',
    content_brief: 'SEO / GEO 策略师',
    code_patch: '增长工程师',
    metadata_rewrite: 'SEO 策略师',
    schema_patch: '增长工程师',
    technical_ticket: '增长工程师',
    landing_revision: '转化策略师',
    utm_plan: '增长运营',
    publish_receipt: '增长运营',
    comparison_brief: '研究编辑',
  };
  const qualityGateLabels = {
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
  const relationLabels = { direct: '直接竞品', indirect: '间接竞品', status_quo: '现状替代', benchmark: '行业标杆', publisher: '内容竞品' };
  const scopeLabels = { full_domain: '全站分析', relevant_keywords: '相关关键词', profile_only: '画像参考', excluded: '不参与分析' };
  const pageTypeLabels = {
    home: '首页', product: '产品页', blog: 'Blog', integration: '集成页', comparison: '对比页', commercial: '商业页',
    resource: '资源页', trust: '信任页', solution: '方案页', template: '模板页', documentation: '文档页',
  };
  const keywordSourceMeta = {
    competitor_gap: { label: '竞品 Keyword Gap', tone: 'blue' },
    content_gap: { label: '内容缺口', tone: 'violet' },
    suggest_paa: { label: 'Seed + Suggest / PAA', tone: 'teal' },
    community_voc: { label: '社区 / VOC', tone: 'amber' },
    trend_signal: { label: '趋势信号', tone: 'coral' },
    gsc_unexpected: { label: 'GSC 意外词', tone: 'green' },
    manual_csv: { label: '手动 / CSV', tone: 'gray' },
    manual: { label: '手动添加', tone: 'gray' },
  };
  const eventLabels = {
    snapshot_created: '数据快照完成', profile_confirmed: '产品画像已确认', finding_confirmed: '问题已确认',
    finding_reviewed: '问题证据审核完成',
    opportunity_reviewed: '机会决定已记录',
    action_created: '执行项已建立', artifact_revised: '交付物已更新', artifact_approved: '交付物已批准',
    change_published: '变更已发布', recheck_completed: '复查完成', observation_recorded: '结果已记录',
    keyword_added: '关键词已入库', competitor_reviewed: '竞品范围已更新', report_shared: '报告已分享', sync_completed: '数据同步完成',
  };

  function derived() {
    const openOpportunities = workspace.opportunities.filter((item) => !['closed', 'dismissed'].includes(item.status));
    const resultTotals = aggregate(activeResultsRecord().pageObservations || []);
    const taggedCampaigns = workspace.campaigns.filter((item) => item.campaign);
    return {
      openOpportunities,
      reviewArtifacts: workspace.artifacts.filter((item) => item.status === 'review'),
      candidateCompetitors: workspace.competitors.filter((item) => item.status === 'candidate'),
      resultTotals,
      taggedTotals: aggregate(taggedCampaigns),
      activeArtifacts: workspace.artifacts.filter((item) => ['review', 'approved', 'in_execution', 'blocked'].includes(item.status)),
    };
  }

  function customerConnections() {
    return workspace.dataSources.filter((source) => source.audienceVisibility === 'customer');
  }

  function internalSignalCount(sourceRefs = []) {
    return sourceRefs.filter((sourceId) => byId(workspace.dataSources, sourceId)?.audienceVisibility === 'internal').length;
  }

  function opportunityCategory(item) {
    const ruleText = item.findingIds.map((id) => byId(workspace.findings, id)?.ruleId || '').join(' ');
    if (/canonical|schema|architecture|orphan|technical/.test(ruleText)) return 'technical';
    if (/geo|ai_|answer_block|citation/.test(ruleText)) return 'geo';
    if (/competitor/.test(ruleText)) return 'competition';
    if (/landing|conversion|form|post_conversion/.test(ruleText)) return 'cro';
    return 'seo';
  }

  function opportunityMix() {
    const config = [
      ['seo', 'SEO 内容', 'coral'],
      ['technical', '技术优化', 'teal'],
      ['geo', 'GEO / AI', 'violet'],
      ['competition', '竞品机会', 'amber'],
      ['cro', 'CRO 转化', 'blue'],
    ];
    const open = derived().openOpportunities;
    const counts = open.reduce((result, item) => {
      const key = opportunityCategory(item);
      result[key] = (result[key] || 0) + 1;
      return result;
    }, {});
    const max = Math.max(1, ...Object.values(counts));
    return config.map(([id, label, tone]) => ({ id, label, tone, count: counts[id] || 0, width: Math.round(((counts[id] || 0) / max) * 100) }));
  }

  function aggregate(records) {
    return records.reduce((totals, record) => {
      Object.entries(record.metrics || {}).forEach(([metric, pair]) => {
        totals[metric] ||= { before: 0, current: 0 };
        totals[metric].before += Number(pair.before || 0);
        totals[metric].current += Number(pair.current || 0);
      });
      return totals;
    }, {});
  }

  const mapTabs = ['pages', 'keywords', 'competitors'];
  const pageViews = ['url', 'cluster', 'opportunity'];
  const artifactFilters = ['all', 'blog', 'brief', 'code', 'metadata', 'landing', 'publish'];
  const resultTabs = ['overview', 'pages', 'campaigns'];
  const overlayKinds = new Set([
    'profile', 'profile-edit', 'profile-evidence', 'profile-history', 'profile-version',
    'connections', 'source-detail', 'sync-run', 'page-filters', 'page-evidence',
    'keyword-detail', 'keyword-add', 'competitor-detail', 'competitor-add',
    'competitor-review', 'finding-review', 'opportunity', 'opportunity-decision',
    'task-preview', 'artifact-share', 'artifact-edit', 'artifact-create',
    'artifact-history', 'artifact-revision', 'artifact-approve', 'artifact-publish',
    'receipt', 'result-page', 'campaign', 'report-share', 'audit-event',
  ]);
  let lastReconciledHref = '';

  function resetRouteState(route) {
    state.urlFlags = freshUrlFlags();
    state.overlay = null;
    state.overlayPayload = null;
    state.evidenceTab = 'summary';
    if (route === 'growth-map') {
      state.mapTab = 'pages';
      state.pageView = 'url';
      state.pageTypeFilter = 'all';
      state.pageTemplateFilter = 'all';
      state.pageClusterFilter = 'all';
      state.pageStatusFilter = 'all';
      state.pageLensFilter = 'all';
      state.pageRowsExpanded = false;
      state.keywordSource = 'all';
      state.searches = { pages: '', keywords: '', competitors: '' };
      state.statusFilters = { pages: 'all', keywords: 'all', competitors: 'all' };
      state.pages = { pages: 1, keywords: 1, competitors: 1 };
      state.selectedPageId = initialSelections.page;
      state.selectedClusterId = initialSelections.cluster;
      state.selectedOpportunityId = initialSelections.opportunity;
      state.selectedKeywordId = initialSelections.keyword;
      state.selectedCompetitorId = initialSelections.competitor;
    }
    if (route === 'execution') {
      state.artifactFilter = 'all';
      state.selectedArtifactId = initialSelections.artifact;
    }
    if (route === 'results') {
      state.resultTab = 'overview';
      state.resultWindowId = defaultResultWindowId;
    }
  }

  function currentMapSelectionId() {
    if (state.mapTab === 'keywords') return state.selectedKeywordId;
    if (state.mapTab === 'competitors') return state.selectedCompetitorId;
    if (state.pageView === 'cluster') return state.selectedClusterId;
    if (state.pageView === 'opportunity') return state.selectedOpportunityId;
    return state.selectedPageId;
  }

  function serializeStateHash() {
    const params = new URLSearchParams();
    const flags = state.urlFlags;
    if (state.route === 'growth-map') {
      if (flags.mapTab) params.set('m', state.mapTab);
      if (state.mapTab === 'pages' && flags.pageView) params.set('v', state.pageView);
      if (flags.pageNumber[state.mapTab]) params.set('p', String(state.pages[state.mapTab]));
      if (flags.selection[state.mapTab] && currentMapSelectionId()) params.set('s', currentMapSelectionId());
      if (flags.search[state.mapTab]) params.set('q', state.searches[state.mapTab]);
      if (flags.status[state.mapTab]) params.set('st', state.statusFilters[state.mapTab]);
      if (state.mapTab === 'keywords' && flags.keywordSource) params.set('src', state.keywordSource);
      if (state.mapTab === 'pages') {
        if (flags.pageType) params.set('pt', state.pageTypeFilter);
        if (flags.pageTemplate) params.set('tpl', state.pageTemplateFilter);
        if (flags.pageCluster) params.set('cl', state.pageClusterFilter);
        if (flags.pageStatus) params.set('ps', state.pageStatusFilter);
        if (flags.pageLens) params.set('ln', state.pageLensFilter);
        if (flags.pageRowsExpanded) params.set('x', state.pageRowsExpanded ? '1' : '0');
      }
    }
    if (state.route === 'execution') {
      if (flags.artifactFilter) params.set('f', state.artifactFilter);
      if (flags.artifactSelection && state.selectedArtifactId) params.set('a', state.selectedArtifactId);
    }
    if (state.route === 'results') {
      if (flags.resultTab) params.set('t', state.resultTab);
      if (flags.resultWindow) params.set('w', state.resultWindowId);
    }
    if (state.overlay) {
      params.set('o', state.overlay);
      const payloadId = state.overlayPayload?.id || (typeof state.overlayPayload === 'string' ? state.overlayPayload : '');
      if (payloadId) params.set('i', payloadId);
      if (state.overlay === 'task-preview' && state.overlayPayload?.kind) params.set('k', state.overlayPayload.kind);
      if (state.overlay === 'page-evidence' && state.evidenceTab !== 'summary') params.set('e', state.evidenceTab);
    }
    const query = params.toString();
    return `#/${state.route}${query ? `?${query}` : ''}`;
  }

  function writeLocation(mode = 'replace') {
    const nextHash = serializeStateHash();
    if (window.location.hash === nextHash) {
      lastReconciledHref = window.location.href;
      return;
    }
    try {
      const method = mode === 'push' ? 'pushState' : 'replaceState';
      window.history[method]({ gengrowthArtifact: true, overlay: Boolean(state.overlay) }, '', nextHash);
    } catch {
      // Some browsers restrict History API calls for file:// documents. A hash
      // fallback keeps the standalone Artifact usable without a local server.
      if (mode === 'replace') window.location.replace(nextHash);
      else window.location.hash = nextHash;
    }
    lastReconciledHref = window.location.href;
  }

  function captureFocus(element) {
    if (!(element instanceof Element)) return null;
    const action = element.dataset?.action;
    if (!action) return { element };
    const identityKeys = ['id', 'route', 'tab', 'filter', 'view', 'kind', 'source', 'cluster'];
    const identity = Object.fromEntries(identityKeys.filter((key) => element.dataset[key]).map((key) => [key, element.dataset[key]]));
    const candidates = [...document.querySelectorAll(`[data-action="${action.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`)]
      .filter((candidate) => Object.entries(identity).every(([key, value]) => candidate.dataset[key] === value));
    return { action, identity, index: Math.max(0, candidates.indexOf(element)), element };
  }

  function restoreFocus(descriptor = state.lastFocus) {
    if (!descriptor) return;
    if (descriptor.action) {
      const candidates = [...document.querySelectorAll(`[data-action="${descriptor.action.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`)]
        .filter((candidate) => Object.entries(descriptor.identity || {}).every(([key, value]) => candidate.dataset[key] === value));
      const target = candidates[Math.min(descriptor.index || 0, Math.max(0, candidates.length - 1))];
      if (target) {
        target.focus({ preventScroll: true });
        return;
      }
    }
    descriptor.element?.focus?.({ preventScroll: true });
  }

  function focusOverlay() {
    window.requestAnimationFrame(() => {
      const dialog = document.querySelector('.client-overlay [role="dialog"]');
      const target = dialog?.querySelector('[data-autofocus], input:not([type="hidden"]), select, textarea, button:not([data-action="close-overlay"]), button');
      target?.focus();
    });
  }

  function commitState(mode = 'push') {
    render();
    writeLocation(mode);
  }

  function setRoute(route, options = {}) {
    if (!allowedRoutes.includes(route)) return;
    resetRouteState(route);
    state.route = route;
    state.mobileNav = false;
    Object.assign(state, options);
    const scrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
    window.scrollTo({ top: 0, behavior: scrollBehavior });
    commitState('push');
    window.requestAnimationFrame(() => document.querySelector('#route-content')?.focus());
  }

  function selectMapObject(stateKey, id) {
    const actionByState = {
      selectedPageId: 'select-map-page',
      selectedClusterId: 'select-map-cluster',
      selectedOpportunityId: 'select-map-opportunity',
      selectedKeywordId: 'select-map-keyword',
      selectedCompetitorId: 'select-map-competitor',
    };
    const collectionByState = {
      selectedPageId: workspace.urls,
      selectedClusterId: workspace.clusters,
      selectedOpportunityId: workspace.opportunities,
      selectedKeywordId: workspace.keywords,
      selectedCompetitorId: workspace.competitors,
    };
    if (!actionByState[stateKey] || !byId(collectionByState[stateKey] || [], id)) return;
    state[stateKey] = id;
    const selectionKind = ['selectedKeywordId'].includes(stateKey)
      ? 'keywords'
      : ['selectedCompetitorId'].includes(stateKey)
        ? 'competitors'
        : 'pages';
    state.urlFlags.selection[selectionKind] = true;
    // Keep selection state and the rendered master-detail tree in one lifecycle.
    // A full render makes repeated URL clicks and tab/view round-trips use the
    // same path, avoiding stale row/detail DOM after a previous partial swap.
    commitState('push');
    window.requestAnimationFrame(() => {
      if (!window.matchMedia('(max-width: 1024px)').matches) {
        const actionSelector = `[data-action="${actionByState[stateKey]}"][data-id="${id}"]`;
        const focusTarget = stateKey === 'selectedPageId'
          ? document.querySelector(`button.v14-page-row-button${actionSelector}`) || document.querySelector(`tr${actionSelector}`)
          : document.querySelector(actionSelector);
        focusTarget?.focus({ preventScroll: true });
        return;
      }
      const detail = document.querySelector('.v13-detail-panel');
      if (!detail) return;
      detail.setAttribute('tabindex', '-1');
      detail.focus({ preventScroll: true });
      const scrollBehavior = window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth';
      detail.scrollIntoView({ behavior: scrollBehavior, block: 'start' });
    });
  }

  function openOverlay(kind, payload = null) {
    if (!overlayKinds.has(kind)) return;
    const wasOpen = Boolean(state.overlay);
    if (!wasOpen) state.lastFocus = captureFocus(document.activeElement);
    if (payload && typeof payload === 'object' && payload.id) overlayPayloadCache.set(payload.id, payload);
    state.overlay = kind;
    state.overlayPayload = payload;
    state.evidenceTab = 'summary';
    commitState(wasOpen ? 'replace' : 'push');
    focusOverlay();
  }

  function closeOverlay(shouldRender = true) {
    state.overlay = null;
    state.overlayPayload = null;
    state.evidenceTab = 'summary';
    if (shouldRender) {
      commitState('replace');
      window.requestAnimationFrame(() => restoreFocus());
    }
  }

  function overlayPayloadFromParams(kind, params) {
    const id = params.get('i');
    if (kind === 'task-preview') return id ? { id, kind: params.get('k') || 'finding' } : null;
    if (kind === 'receipt') {
      return (id && overlayPayloadCache.get(id))
        || workspace.releases.find((item) => item.id === id)
        || workspace.shareReceipts.find((item) => item.id === id)
        || null;
    }
    return id ? { id } : null;
  }

  function hydrateStateFromLocation() {
    const raw = window.location.hash.replace(/^#\/?/, '');
    const [routeCandidate, query = ''] = raw.split('?');
    const route = allowedRoutes.includes(routeCandidate) ? routeCandidate : 'overview';
    const params = new URLSearchParams(query);
    resetRouteState(route);
    state.route = route;
    state.mobileNav = false;

    if (route === 'growth-map') {
      const requestedTab = params.get('m');
      if (mapTabs.includes(requestedTab)) {
        state.mapTab = requestedTab;
        state.urlFlags.mapTab = true;
      }
      const requestedView = params.get('v');
      if (state.mapTab === 'pages' && pageViews.includes(requestedView)) {
        state.pageView = requestedView;
        state.urlFlags.pageView = true;
      }
      const page = Number(params.get('p'));
      if (params.has('p') && Number.isInteger(page) && page > 0 && page < 1000) {
        state.pages[state.mapTab] = page;
        state.urlFlags.pageNumber[state.mapTab] = true;
      }
      const selection = params.get('s');
      const selectionConfig = state.mapTab === 'keywords'
        ? ['selectedKeywordId', workspace.keywords]
        : state.mapTab === 'competitors'
          ? ['selectedCompetitorId', workspace.competitors]
          : state.pageView === 'cluster'
            ? ['selectedClusterId', workspace.clusters]
            : state.pageView === 'opportunity'
              ? ['selectedOpportunityId', workspace.opportunities]
              : ['selectedPageId', workspace.urls];
      if (selection && byId(selectionConfig[1], selection)) {
        state[selectionConfig[0]] = selection;
        state.urlFlags.selection[state.mapTab] = true;
      }
      if (params.has('q')) {
        state.searches[state.mapTab] = String(params.get('q') || '').slice(0, 160);
        state.urlFlags.search[state.mapTab] = true;
      }
      if (params.has('st')) {
        state.statusFilters[state.mapTab] = String(params.get('st') || 'all').slice(0, 80);
        state.urlFlags.status[state.mapTab] = true;
      }
      if (state.mapTab === 'keywords' && params.has('src')) {
        const source = params.get('src');
        const allowedSources = new Set(['all', ...workspace.keywords.map((item) => item.sourceKind)]);
        if (allowedSources.has(source)) {
          state.keywordSource = source;
          state.urlFlags.keywordSource = true;
        }
      }
      if (state.mapTab === 'pages') {
        const filters = [
          ['pt', 'pageTypeFilter', 'pageType', new Set(['all', ...workspace.urls.map((item) => item.pageType)])],
          ['tpl', 'pageTemplateFilter', 'pageTemplate', new Set(['all', ...workspace.urls.map((item) => item.templateKey).filter(Boolean)])],
          ['cl', 'pageClusterFilter', 'pageCluster', new Set(['all', ...workspace.clusters.map((item) => item.id)])],
          ['ps', 'pageStatusFilter', 'pageStatus', new Set(['all', ...workspace.urls.map((item) => item.status)])],
          ['ln', 'pageLensFilter', 'pageLens', new Set(['all', ...Object.keys(labels.lens)])],
        ];
        filters.forEach(([param, stateKey, flagKey, allowed]) => {
          const value = params.get(param);
          if (params.has(param) && allowed.has(value)) {
            state[stateKey] = value;
            state.urlFlags[flagKey] = true;
          }
        });
        if (params.has('x')) {
          state.pageRowsExpanded = params.get('x') === '1';
          state.urlFlags.pageRowsExpanded = true;
        }
      }
    }

    if (route === 'execution') {
      const filter = params.get('f');
      if (artifactFilters.includes(filter)) {
        state.artifactFilter = filter;
        state.urlFlags.artifactFilter = true;
      }
      const artifactId = params.get('a');
      if (artifactId && byId(workspace.artifacts, artifactId)) {
        state.selectedArtifactId = artifactId;
        state.urlFlags.artifactSelection = true;
      }
    }

    if (route === 'results') {
      const tab = params.get('t');
      if (resultTabs.includes(tab)) {
        state.resultTab = tab;
        state.urlFlags.resultTab = true;
      }
      const resultWindowIds = new Set([
        defaultResultWindowId,
        ...(workspace.results.windows || []).map((item) => item.id),
      ]);
      const windowId = params.get('w');
      if (windowId && resultWindowIds.has(windowId)) {
        state.resultWindowId = windowId;
        state.urlFlags.resultWindow = true;
      }
    }

    const overlay = params.get('o');
    if (overlayKinds.has(overlay)) {
      const idRequired = new Set([
        'profile-version', 'source-detail', 'page-evidence', 'keyword-detail',
        'competitor-detail', 'competitor-review', 'finding-review', 'opportunity',
        'opportunity-decision', 'task-preview', 'artifact-share', 'artifact-edit',
        'artifact-create', 'artifact-history', 'artifact-revision', 'artifact-approve',
        'artifact-publish', 'result-page', 'campaign', 'audit-event',
      ]);
      const payload = overlayPayloadFromParams(overlay, params);
      if (!idRequired.has(overlay) || payload) {
        state.overlay = overlay;
        state.overlayPayload = payload;
        if (overlay === 'page-evidence' && ['summary', 'crawl', 'analytics', 'history'].includes(params.get('e'))) {
          state.evidenceTab = params.get('e');
        }
      }
    }
  }

  function reconcileLocation() {
    if (window.location.href === lastReconciledHref) return;
    const hadOverlay = Boolean(state.overlay);
    hydrateStateFromLocation();
    render();
    writeLocation('replace');
    if (state.overlay) focusOverlay();
    else if (hadOverlay) window.requestAnimationFrame(() => restoreFocus());
  }

  function recordEvent(type, objectRefs, actorId = 'customer-user') {
    workspace.auditEvents.unshift({
      id: `evt-${type}-${Date.now()}`,
      projectId: workspace.project.id,
      type,
      actorType: 'user',
      actorId,
      at: new Date().toISOString(),
      objectRefs,
    });
  }

  function profileCompleteness() {
    const values = [
      workspace.profile.productCategory,
      workspace.profile.oneLiner,
      workspace.profile.valueProposition,
      workspace.profile.primaryIcp.company,
      workspace.profile.primaryIcp.buyer,
      workspace.profile.primaryIcp.champion,
      workspace.profile.primaryIcp.users,
      workspace.profile.primaryIcp.jobsToBeDone,
      workspace.profile.primaryIcp.buyingTriggers,
      workspace.profile.evidenceRefs,
    ];
    const completed = values.filter((value) => Array.isArray(value) ? value.length > 0 : Boolean(value)).length;
    return Math.round((completed / values.length) * 100);
  }

  function profileFieldRecords(profile = workspace.profile) {
    const fields = profile.profileFields || [];
    return Array.isArray(fields)
      ? fields
      : Object.entries(fields).map(([key, value]) => ({ key, ...(value || {}) }));
  }

  function displayProfileValue(value) {
    if (Array.isArray(value)) return value.join(' · ') || '待补充';
    if (value && typeof value === 'object') return Object.values(value).flat().join(' · ') || '待补充';
    return String(value ?? '待补充');
  }

  function profileConfidenceLabel(value) {
    return labels.profileFieldConfidence?.[value] || ({ 1: '高', 0.75: '中', 0.4: '低', 0: '未知' })[String(value)] || String(value || '未知');
  }

  function artifactRevisionSnapshot(item, fields = {}) {
    return {
      id: `${item.id}-r${fields.revision ?? item.revision}`,
      artifactId: item.id,
      revision: fields.revision ?? item.revision,
      createdAt: fields.createdAt || item.updatedAt || item.approvedAt || seed.snapshotAt,
      createdBy: fields.createdBy || 'customer-user',
      title: fields.title || item.title,
      type: item.type,
      statusAtCreation: fields.statusAtCreation || item.status,
      revisionNote: fields.revisionNote || item.revisionNote || '客户可见版本',
      changeNote: fields.changeNote || item.changeNote || '版本内容已记录。',
      requiredGates: clone(fields.requiredGates || item.requiredGates),
      passedGates: clone(fields.passedGates || item.passedGates),
      targetUrlIds: clone(item.targetUrlIds),
      sourceRefs: clone(item.sourceRefs),
      documentId: fields.documentId || item.documentId || null,
      generatedContent: clone(fields.generatedContent || item.generatedContent || null),
    };
  }

  function shell(content) {
    const nav = [
      ['overview', 'home', '概览', '当前优先事项'],
      ['growth-map', 'map', '增长地图', '页面 · 关键词 · 竞品'],
      ['execution', 'execute', '执行中心', '审核并处理交付物'],
      ['results', 'results', '效果追踪', '改前 / 改后'],
    ];
    const completeness = profileCompleteness();
    return `
      <div class="app-shell client-shell ${state.mobileNav ? 'is-nav-open' : ''}">
        <aside id="primary-navigation" class="sidebar client-sidebar" aria-label="主导航" ${state.overlay ? 'inert aria-hidden="true"' : ''}>
          <div class="brand"><span class="brand__mark">G</span><span><strong>GenGrowth</strong><small>海外增长工作台</small></span></div>
          <button class="project-switcher" data-action="open-profile" aria-label="查看 RelayOps 产品画像">
            <span class="project-switcher__avatar">RO</span><span><strong>${escapeHtml(workspace.project.name)}</strong><small>${escapeHtml(workspace.project.primaryMarket)} · B2B SaaS</small></span>${icon('arrow')}
          </button>
          <nav class="primary-nav">
            ${nav.map(([route, glyph, label, hint]) => `
              <button class="nav-item ${state.route === route ? 'is-active' : ''}" data-action="nav" data-route="${route}">
                <span class="nav-item__icon">${icon(glyph)}</span><span><strong>${label}</strong><small>${hint}</small></span>
              </button>`).join('')}
          </nav>
          <div class="sidebar__spacer"></div>
          <div class="v14-sidebar-profile">
            <span>产品画像</span>
            <strong>${escapeHtml(workspace.project.name)}</strong>
            <p>${escapeHtml(workspace.profile.oneLiner)}</p>
            <button data-action="open-profile">查看产品画像 · ${completeness}%</button>
          </div>
          <div class="v14-sidebar-footnote">${seed.datasetKind === 'scenario' ? '场景数据' : '实时数据'} · ${seed.snapshotAt.slice(0, 10)}</div>
        </aside>
        <button class="client-nav-scrim" data-action="toggle-nav" aria-label="关闭导航" ${state.overlay ? 'inert aria-hidden="true"' : ''}></button>
        <main class="workspace" ${state.overlay ? 'inert aria-hidden="true"' : ''}>
          <header class="topbar client-topbar">
            <button class="client-menu-button" data-action="toggle-nav" aria-label="${state.mobileNav ? '关闭导航' : '打开导航'}" aria-expanded="${state.mobileNav}" aria-controls="primary-navigation">${icon('menu')}</button>
            <div class="client-breadcrumb"><span>${workspace.project.name}</span>${icon('arrow')}<strong>${nav.find(([route]) => route === state.route)?.[2]}</strong></div>
            <div class="topbar__actions">
              <span class="v14-topbar-pill">${icon('globe')} 主要市场 · ${escapeHtml(workspace.project.primaryMarket)}</span>
              <button class="v14-topbar-pill" data-action="open-profile">产品画像 <strong>${completeness}%</strong></button>
              <button class="client-avatar" data-action="open-profile" aria-label="查看产品画像">WZ</button>
            </div>
          </header>
          <div class="client-scenario-notice" role="note" aria-label="离线演示场景说明">
            <strong>离线演示场景</strong>
            <span>${escapeHtml(workspace.scenarioNotice)} 审核、Revision、分享、发布和结果更新仅保存在当前浏览器会话，刷新页面后重置。</span>
          </div>
          <section class="client-stage" id="route-content" tabindex="-1">${content}</section>
        </main>
        ${renderOverlay()}
      </div>`;
  }

  function pageHeader(eyebrow, title, description, actions = '') {
    return `<header class="client-page-header"><div><span class="eyebrow">${eyebrow}</span><h1>${title}</h1><p>${description}</p></div>${actions ? `<div class="client-page-actions">${actions}</div>` : ''}</header>`;
  }

  function renderOverview() {
    const d = derived();
    const queueGroups = [
      d.reviewArtifacts.map((item) => ({ kind: 'artifact', id: item.id, label: artifactTypeLabels[item.type], title: item.title, meta: `${item.targetUrlIds.map(urlName).join(', ')} · 版本 ${item.revision}` })),
      d.candidateCompetitors.map((item) => ({ kind: 'competitor', id: item.id, label: '竞品候选', title: `确认 ${item.name} 的竞品范围`, meta: `${item.domain} · ${item.organicOverlapPct}% 自然搜索重合度` })),
      workspace.findings.filter((item) => item.status === 'unreviewed').map((item) => ({ kind: 'finding', id: item.id, label: '证据审核', title: item.title, meta: urlName(item.urlIds[0]) })),
    ];
    const queue = queueGroups
      .flatMap((group) => group[0] ? [group[0]] : [])
      .concat(queueGroups.flatMap((group) => group.slice(1)))
      .slice(0, 3);
    const mix = opportunityMix();
    const connections = customerConnections();
    const primaryConversion = workspace.project.conversionGoals.find((item) => item.id === workspace.project.primaryConversionId);
    return `${pageHeader('RelayOps · 美国市场', '今天先做这 3 件事', '先完成需要客户判断的事项，再从同一条链路查看增长机会、交付物与结果。', '<button class="button button--primary" data-action="nav" data-route="growth-map">查看全部机会</button>')}
      <section class="v13-overview-grid v13-overview-grid--top">
        <article class="panel v13-priority-panel">
          <div class="panel-heading"><div><span class="eyebrow">待决策队列</span><h2>接下来优先做</h2></div><span>按客户决策顺序</span></div>
          <div class="v13-priority-list">${queue.map((item, index) => `<button class="v13-priority-item" data-action="open-task" data-kind="${item.kind}" data-id="${item.id}"><span class="v13-priority-number tone-${['coral', 'teal', 'amber'][index]}">${String(index + 1).padStart(2, '0')}</span><span><small>${escapeHtml(item.label)}</small><strong>${escapeHtml(item.title)}</strong><em>${escapeHtml(item.meta)}</em></span>${icon('arrow')}</button>`).join('') || '<div class="empty-state">当前没有需要客户确认的事项。</div>'}</div>
        </article>
        <article class="panel v13-mix-panel">
          <div class="panel-heading"><div><span class="eyebrow">机会构成</span><h2>全站机会分布</h2></div><span>共 ${d.openOpportunities.length} 条</span></div>
          <div class="v13-mix-chart">${mix.map((item) => `<div class="v13-mix-row"><span>${item.label}</span><div><i class="tone-${item.tone}" style="width:${item.width}%"></i></div><strong>${item.count}</strong></div>`).join('')}</div>
          <button class="text-button" data-action="nav" data-route="growth-map">打开增长地图 ${icon('arrow')}</button>
        </article>
      </section>
      <section class="v13-overview-grid v13-overview-grid--bottom">
        <article class="panel v13-source-panel">
          <div class="panel-heading"><div><span class="eyebrow">数据来源</span><h2>分析连接状态</h2></div><button class="text-button" data-action="open-connections">管理连接</button></div>
          <div class="client-asset-strip" aria-label="分析资产覆盖"><div><strong>${workspace.urls.length}</strong><span>URLs</span></div><div><strong>${workspace.keywords.length}</strong><span>关键词</span></div><div><strong>${workspace.competitors.length}</strong><span>竞品</span></div><div><strong>${workspace.clusters.length}</strong><span>主题簇</span></div></div>
          <div class="v13-connection-grid">${connections.map((source) => { const connectionState = source.connectionState || (source.status === 'planned' ? 'unavailable' : 'available'); return `<button class="v13-connection-item" data-action="open-source" data-id="${source.id}"><span class="v13-connection-mark ${connectionState === 'unavailable' ? 'is-planned' : ''}">${source.kind === 'search_console' ? 'GSC' : source.kind === 'analytics' ? 'GA4' : 'GH'}</span><span><strong>${escapeHtml(source.name)}</strong><small>${connectionState === 'unavailable' ? '预留 · 自动创建 PR / 合并回执' : `离线场景快照 · ${dateZh(source.observedAt)}`}</small></span>${badge(connectionStateLabels[connectionState] || connectionState, ['available', 'connected'].includes(connectionState) ? 'success' : connectionState === 'failed' ? 'warning' : 'neutral')}${icon('arrow')}</button>`; }).join('')}</div>
          <p class="v13-source-note">抓取、研究与内容证据由系统自动维护，不需要额外连接。</p>
        </article>
        <article class="panel v13-context-panel">
          <div class="panel-heading"><div><span class="eyebrow">已确认业务上下文</span><h2>谁、在哪个市场、要完成什么</h2></div>${badge(`v${workspace.profile.version} 已确认`, 'success')}</div>
          <dl><div><dt>ICP</dt><dd>${escapeHtml(workspace.profile.primaryIcp.champion)} · ${escapeHtml(workspace.profile.primaryIcp.company)}</dd></div><div><dt>JTBD</dt><dd>${escapeHtml(workspace.profile.primaryIcp.jobsToBeDone[0])}</dd></div><div><dt>目标市场</dt><dd>美国 · 英文内容</dd></div><div><dt>主要转化</dt><dd>${escapeHtml(primaryConversion?.label || '—')}</dd></div></dl>
          <div class="client-profile-meta"><span>更新于 ${dateZh(workspace.profile.confirmedAt)}</span><span>低置信度 ${workspace.profile.lowConfidenceFieldCount ?? 0}</span><span>画像待确认 ${workspace.profile.pendingConfirmationCount ?? 0}</span><span>竞品候选 ${d.candidateCompetitors.length}</span></div>
          <button class="button button--secondary button--full" data-action="open-profile">查看并更新产品与 ICP 画像</button>
        </article>
      </section>`;
  }

  function metricCompare(label, pair) {
    if (!pair) return '';
    if (pair.before === null || pair.before === undefined || pair.current === null || pair.current === undefined) {
      return `<div><span>${label}</span><strong>不可用</strong><small>当前固定窗口尚无可比较观测</small></div>`;
    }
    return `<div><span>${label}</span><strong>${compact(pair.current)}</strong><small>${compact(pair.before)} → ${compact(pair.current)} · ${percent(pair.before, pair.current)}</small></div>`;
  }

  function metricPairText(pair) {
    if (!pair || pair.before === null || pair.before === undefined || pair.current === null || pair.current === undefined) return '不可用';
    return `${compact(pair.before)} → ${compact(pair.current)}`;
  }

  function activeResultsRecord() {
    return (workspace.results.windows || []).find((item) => item.id === state.resultWindowId) || workspace.results;
  }

  function activeResultWindow() {
    const results = activeResultsRecord();
    return {
      id: results.windowId || results.id || state.resultWindowId || defaultResultWindowId,
      baseline: results.baselineWindow || workspace.results.baselineWindow,
      current: results.currentWindow || workspace.results.currentWindow,
    };
  }

  function filterRows(kind, rows) {
    const query = state.searches[kind].trim().toLowerCase();
    const status = state.statusFilters[kind];
    return rows.filter((item) => {
      const searchable = kind === 'pages' ? `${item.path} ${item.title}` : kind === 'keywords' ? `${item.text} ${item.intent}` : `${item.name} ${item.domain}`;
      const sourceMatches = kind !== 'keywords' || state.keywordSource === 'all' || item.sourceKind === state.keywordSource;
      return (!query || searchable.toLowerCase().includes(query)) && (status === 'all' || item.status === status) && sourceMatches;
    });
  }

  function paginate(kind, rows) {
    const pageSize = kind === 'pages' ? 8 : state.pageSize;
    const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
    state.pages[kind] = Math.min(state.pages[kind], totalPages);
    const start = (state.pages[kind] - 1) * pageSize;
    return { rows: rows.slice(start, start + pageSize), totalPages, total: rows.length };
  }

  function renderGrowthMap() {
    const tabs = [
      ['pages', '页面与机会', workspace.urls.length, '个 URL'],
      ['keywords', '关键词库', workspace.keywords.length, '个关键词'],
      ['competitors', '竞品库', workspace.competitors.length, '个域名'],
    ];
    const actions = `<button class="button button--secondary" data-action="open-connections">数据连接</button><button class="button button--primary" data-action="start-sync">${icon('sync')} 更新分析数据</button>`;
    return `${pageHeader('增长地图', '从全站数据里找到下一批增长机会', '按 URL 管理整站机会，也可以进入关键词库和竞品库，查看每条数据的上下文、关联对象与下一步。', actions)}
      <section class="panel v13-map-tabs v14-map-tabs" role="tablist" aria-label="增长地图对象">
        ${tabs.map(([key, label, count, unit]) => `<button id="tab-map-${key}" role="tab" aria-controls="panel-map-${key}" aria-selected="${state.mapTab === key}" tabindex="${state.mapTab === key ? '0' : '-1'}" class="${state.mapTab === key ? 'is-active' : ''}" data-action="map-tab" data-tab="${key}"><strong>${label}</strong><span>${compact(count)} ${unit}</span></button>`).join('')}
      </section>
      <div id="panel-map-${state.mapTab}" role="tabpanel" aria-labelledby="tab-map-${state.mapTab}">${state.mapTab === 'pages' ? renderPageLibrary() : state.mapTab === 'keywords' ? renderKeywordLibrary() : renderCompetitorLibrary()}</div>`;
  }

  function libraryToolbar(kind, placeholder, statusOptions, extra = '') {
    return `<div class="client-library-toolbar v13-library-toolbar"><label class="client-search">${icon('search')}<input type="search" data-search="${kind}" value="${escapeHtml(state.searches[kind])}" placeholder="${placeholder}" aria-label="${placeholder}"></label><label class="client-select-label"><span>状态</span><select data-filter="${kind}"><option value="all">全部状态</option>${statusOptions.map(([value, label]) => `<option value="${value}" ${state.statusFilters[kind] === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>${extra}</div>`;
  }

  function tablePager(kind, page) {
    return `<footer class="client-pager"><span>当前筛选 ${page.total} 条 · 第 ${state.pages[kind]} / ${page.totalPages} 页</span><div><button class="button button--secondary button--small" data-action="page-change" data-kind="${kind}" data-delta="-1" ${state.pages[kind] <= 1 ? 'disabled' : ''}>上一页</button><button class="button button--secondary button--small" data-action="page-change" data-kind="${kind}" data-delta="1" ${state.pages[kind] >= page.totalPages ? 'disabled' : ''}>下一页</button></div></footer>`;
  }

  function sortOpportunities(items) {
    const priority = { p0: 0, p1: 1, p2: 2 };
    const status = { in_execution: 0, confirmed: 1, observing: 2, identified: 3, delivered: 4 };
    return [...items].sort((a, b) => (priority[a.priority] ?? 9) - (priority[b.priority] ?? 9)
      || (status[a.status] ?? 9) - (status[b.status] ?? 9)
      || b.findingIds.length - a.findingIds.length
      || a.title.localeCompare(b.title));
  }

  function pageGrowthNode(item) {
    const findings = workspace.findings.filter((finding) => finding.urlIds.includes(item.id) && finding.status !== 'dismissed');
    const opportunities = sortOpportunities(workspace.opportunities.filter((opportunity) => opportunity.urlIds.includes(item.id) && !['dismissed', 'closed'].includes(opportunity.status)));
    const artifacts = workspace.artifacts.filter((artifact) => artifact.targetUrlIds.includes(item.id));
    const keywords = workspace.keywords.filter((keyword) => keyword.mappedUrlId === item.id);
    const rankedKeywords = keywords.filter((keyword) => Number.isFinite(keyword.currentRank));
    const observation = workspace.results.pageObservations.find((result) => result.urlId === item.id);
    const cluster = byId(workspace.clusters, item.clusterId);
    const searchFindings = findings.filter((finding) => /^search\./.test(finding.ruleId));
    const technicalFindings = findings.filter((finding) => finding.lens === 'webtech');
    const aiEvidenceFindings = findings.filter((finding) => finding.sourceRefs.includes('src-ai-answers') || /(^geo\.|answer_block|ai_|citation)/i.test(finding.ruleId));
    const contentFindings = findings.filter((finding) => /^content\./.test(finding.ruleId) || /schema\./.test(finding.ruleId));
    const contentArtifacts = artifacts.filter((artifact) => ['english_blog_draft', 'content_brief', 'metadata_rewrite', 'landing_revision', 'comparison_brief'].includes(artifact.type));
    const hasPageAiCapture = item.sourceRefs.includes('src-ai-answers');
    const hasObservedAiCitation = Number(observation?.metrics?.aiCitations?.current || 0) > 0;
    const avgPosition = rankedKeywords.length ? rankedKeywords.reduce((sum, keyword) => sum + keyword.currentRank, 0) / rankedKeywords.length : null;
    return {
      ...item,
      findings,
      opportunities,
      artifacts,
      keywords,
      observation,
      cluster,
      avgPosition,
      clicks: observation?.metrics?.clicks?.current ?? null,
      signals: {
        technical: technicalFindings.length,
        search: rankedKeywords.length + searchFindings.length,
        generative: aiEvidenceFindings.length + (hasPageAiCapture ? 1 : 0) + (!aiEvidenceFindings.length && !hasPageAiCapture && hasObservedAiCitation ? 1 : 0),
        content: Math.max(contentFindings.length, contentArtifacts.length),
      },
      topOpportunity: opportunities[0] || null,
    };
  }

  function renderSignalBadges(signals) {
    const config = [
      ['technical', 'T', '技术'],
      ['search', 'S', '搜索'],
      ['generative', 'G', 'GEO / AI'],
      ['content', 'C', '内容'],
    ];
    return `<span class="v14-signal-badges">${config.map(([key, short, label]) => `<span class="is-${key}" title="${label}" aria-label="${label}：${signals[key]}">${short} ${signals[key]}</span>`).join('')}</span>`;
  }

  function opportunityOutput(opportunity) {
    const artifact = opportunity?.artifactIds.map((id) => byId(workspace.artifacts, id)).find(Boolean);
    if (artifact) return { label: artifactTypeLabels[artifact.type] || artifact.type, artifact };
    const fallback = { webtech: '技术修复单', acquisition: '内容 Brief', landing: 'Landing 页面改版', diagnosis: '诊断证据 Brief' };
    return { label: fallback[opportunity?.lens] || '执行 Brief', artifact: null };
  }

  function renderOpportunityCard(opportunity) {
    if (!opportunity) return '<div class="v14-no-opportunity"><strong>当前没有待处理机会</strong><p>页面继续保留在监测范围；后续命中新证据时会自动进入机会队列。</p></div>';
    const findings = opportunity.findingIds.map((id) => byId(workspace.findings, id)).filter(Boolean);
    const output = opportunityOutput(opportunity);
    const title = findings[0]?.title || opportunity.title;
    const description = findings[0]
      ? `${opportunity.title}。${findings.length > 1 ? `另有 ${findings.length - 1} 条关联证据。` : '已形成可执行机会。'}`
      : '该机会由当前页面的关联证据建立。';
    const action = output.artifact
      ? `<button data-action="go-artifact" data-id="${output.artifact.id}">去执行 ${icon('arrow')}</button>`
      : `<button data-action="open-opportunity" data-id="${opportunity.id}">查看机会 ${icon('arrow')}</button>`;
    return `<article class="v14-opportunity-card"><div class="v14-opportunity-tags">${badge(labels.lens[opportunity.lens], 'active')}${badge(opportunity.priority.toUpperCase(), opportunity.priority === 'p0' ? 'warning' : 'neutral')}</div><h4>${escapeHtml(title)}</h4><p>${escapeHtml(description)}</p><footer><span>输出：<strong>${escapeHtml(output.label)}</strong></span>${action}</footer></article>`;
  }

  function renderPageSummary(nodes) {
    const scopedNodes = nodes;
    const scopedPageIds = new Set(scopedNodes.map((item) => item.id));
    const scopedClusterIds = new Set(scopedNodes.map((item) => item.clusterId).filter(Boolean));
    const openOpportunities = workspace.opportunities.filter((item) => !['closed', 'dismissed'].includes(item.status) && item.urlIds.some((id) => scopedPageIds.has(id)));
    const opportunityPages = scopedNodes.filter((item) => item.opportunities.length > 0);
    const pagesWithOpportunity = opportunityPages.length;
    const uncoveredKeywords = workspace.keywords.filter((item) => !item.mappedUrlId && (!scopedClusterIds.size || scopedClusterIds.has(item.clusterId)));
    const uncoveredClusters = new Set(uncoveredKeywords.map((item) => item.clusterId).filter(Boolean)).size;
    const sitemapCount = scopedNodes.filter((item) => item.sourceRefs.includes('src-sitemap')).length;
    const crawlOnlyCount = scopedNodes.filter((item) => item.sourceRefs.includes('src-crawl') && !item.sourceRefs.includes('src-sitemap')).length;
    const priorities = ['p0', 'p1', 'p2'].map((value) => `${value.toUpperCase()} ${opportunityPages.filter((item) => item.priority === value).length}`).join(' · ');
    return `<section class="v14-page-summary" aria-label="当前页面范围摘要"><div><span>已收录页面</span><strong>${compact(scopedNodes.length)}</strong><small>Sitemap ${sitemapCount} · Crawl 新发现 ${crawlOnlyCount}</small></div><div><span>有机会的 URLs</span><strong>${compact(pagesWithOpportunity)}</strong><small>${priorities}</small></div><div><span>增长机会</span><strong>${compact(openOpportunities.length)}</strong><small>多个信号可合并为一个机会</small></div><div><span>未覆盖关键词</span><strong>${compact(uncoveredKeywords.length)}</strong><small>涉及 ${uncoveredClusters} 个主题簇</small></div></section>`;
  }

  function renderPageToolbar() {
    const pageTypes = [...new Set(workspace.urls.map((item) => item.pageType))].sort((a, b) => (pageTypeLabels[a] || a).localeCompare(pageTypeLabels[b] || b, 'zh-CN'));
    const views = [['url', '按 URL'], ['cluster', '按主题簇'], ['opportunity', '按机会']];
    const advancedCount = [state.pageTemplateFilter, state.pageClusterFilter, state.pageStatusFilter, state.pageLensFilter].filter((value) => value !== 'all').length;
    return `<section class="v14-page-toolbar"><div class="v14-page-search"><label>${icon('search')}<input type="search" data-search="pages" value="${escapeHtml(state.searches.pages)}" placeholder="搜索 URL、页面标题或机会" aria-label="搜索 URL、页面标题或机会"></label><button data-action="page-search">搜索</button></div><label class="v14-page-type"><span>页面类型</span><select data-page-type-filter><option value="all">全部类型</option>${pageTypes.map((type) => `<option value="${type}" ${state.pageTypeFilter === type ? 'selected' : ''}>${escapeHtml(pageTypeLabels[type] || type)}</option>`).join('')}</select></label><div class="v14-page-toolbar-actions"><button class="button button--secondary button--small" data-action="open-page-filters">更多筛选${advancedCount ? ` · ${advancedCount}` : ''}</button><button class="button button--secondary button--small" data-action="toggle-page-rows" aria-pressed="${state.pageRowsExpanded}">${state.pageRowsExpanded ? '收起本页' : '展开本页详情'}</button></div><div class="v14-page-views"><span>查看方式</span><div role="tablist" aria-label="页面机会查看方式">${views.map(([key, label]) => `<button id="tab-page-view-${key}" role="tab" aria-controls="panel-page-view-${key}" aria-selected="${state.pageView === key}" tabindex="${state.pageView === key ? '0' : '-1'}" class="${state.pageView === key ? 'is-active' : ''}" data-action="page-view" data-view="${key}">${label}</button>`).join('')}</div></div></section>`;
  }

  function filterPageNodes(nodes) {
    return nodes.filter((item) => {
      const hasLens = state.pageLensFilter === 'all'
        || item.findings.some((finding) => finding.lens === state.pageLensFilter)
        || item.opportunities.some((opportunity) => opportunity.lens === state.pageLensFilter);
      return (state.pageTypeFilter === 'all' || item.pageType === state.pageTypeFilter)
        && (state.pageTemplateFilter === 'all' || item.templateKey === state.pageTemplateFilter)
        && (state.pageClusterFilter === 'all' || item.clusterId === state.pageClusterFilter)
        && (state.pageStatusFilter === 'all' || item.status === state.pageStatusFilter)
        && hasLens;
    });
  }

  function renderPageLibrary() {
    const nodes = filterPageNodes(workspace.urls.map(pageGrowthNode));
    const content = state.pageView === 'cluster' ? renderClusterPageView(nodes) : state.pageView === 'opportunity' ? renderOpportunityPageView(nodes) : renderUrlPageView(nodes);
    return `${renderPageSummary(nodes)}${renderPageToolbar()}<div id="panel-page-view-${state.pageView}" role="tabpanel" aria-labelledby="tab-page-view-${state.pageView}">${content}</div>`;
  }

  function renderUrlPageView(nodes) {
    const query = state.searches.pages.trim().toLowerCase();
    const priority = { p0: 0, p1: 1, p2: 2 };
    const sourceOrder = new Map(workspace.urls.map((item, index) => [item.id, index]));
    const filtered = nodes.filter((item) => {
      const opportunityText = item.opportunities.map((opportunity) => opportunity.title).join(' ');
      return !query || `${item.path} ${item.title} ${opportunityText}`.toLowerCase().includes(query);
    }).sort((a, b) => (priority[a.topOpportunity?.priority] ?? 9) - (priority[b.topOpportunity?.priority] ?? 9) || (sourceOrder.get(a.id) ?? 999) - (sourceOrder.get(b.id) ?? 999));
    const page = paginate('pages', filtered);
    if (!page.rows.some((item) => item.id === state.selectedPageId)) state.selectedPageId = page.rows[0]?.id || filtered[0]?.id;
    const selected = nodes.find((item) => item.id === state.selectedPageId);
    return `<section class="v13-master-detail v14-page-layout"><div class="panel v13-table-card v14-page-table-card"><div class="client-table-scroll"><table class="client-table v13-table client-page-table v14-page-table"><thead><tr><th>URL / 页面</th><th>类型</th><th>机会信号</th><th>自然搜索点击</th><th>平均排名</th><th>当前状态</th></tr></thead><tbody>${page.rows.map((item) => {
      const selectedRow = item.id === selected?.id;
      const expanded = state.pageRowsExpanded ? `<tr class="v14-expanded-row"><td colspan="6"><div><span>页面模板 <strong>${escapeHtml(item.templateKey || '未识别')}</strong></span><span>主题簇 <strong>${escapeHtml(item.cluster?.label || '未分组')}</strong></span><span>来源 <strong>${item.sourceRefs.map(sourceName).join(' · ')}</strong></span></div><section>${item.opportunities.map((opportunity) => `<button data-action="open-opportunity" data-id="${opportunity.id}"><span>${badge(opportunity.priority.toUpperCase(), opportunity.priority === 'p0' ? 'warning' : 'neutral')}</span><strong>${escapeHtml(opportunity.title)}</strong>${icon('arrow')}</button>`).join('') || '<p>当前没有开放机会，继续监测。</p>'}</section></td></tr>` : '';
      return `<tr class="${selectedRow ? 'is-selected' : ''}" data-page-id="${item.id}" data-action="select-map-page" data-id="${item.id}" aria-selected="${selectedRow}" aria-label="选择 URL ${escapeHtml(item.path)}"><td data-label="URL / 页面"><button type="button" class="client-primary-cell v14-page-row-button" data-page-id="${item.id}" data-action="select-map-page" data-id="${item.id}" aria-pressed="${selectedRow}" aria-label="查看 ${escapeHtml(item.path)} 的详情"><strong>${escapeHtml(item.path)}</strong><small>${escapeHtml(item.title)}</small></button></td><td data-label="类型">${escapeHtml(pageTypeLabels[item.pageType] || item.pageType)}</td><td data-label="机会信号">${renderSignalBadges(item.signals)}</td><td data-label="自然搜索点击"><span><strong>${item.clicks === null ? '—' : compact(item.clicks)}</strong><small>${workspace.results.currentWindow.days} 天</small></span></td><td data-label="平均排名"><span><strong>${item.avgPosition === null ? '—' : item.avgPosition.toFixed(1)}</strong><small>映射关键词均值</small></span></td><td data-label="当前状态">${badge(statusLabel('urlStatus', item.status), toneFor(item.status))}</td></tr>${expanded}`;
    }).join('') || '<tr><td colspan="6"><div class="empty-state">没有匹配的 URL。</div></td></tr>'}</tbody></table></div>${page.totalPages > 1 ? tablePager('pages', page) : ''}</div>${selected ? renderPageDetailPanel(selected) : '<aside class="panel v13-detail-panel v14-url-detail"><div class="empty-state">请选择一个 URL。</div></aside>'}</section>`;
  }

  function renderPageDetailPanel(item) {
    const topOpportunity = item.topOpportunity;
    const opportunityCards = item.opportunities.length
      ? item.opportunities.map((opportunity) => renderOpportunityCard(opportunity)).join('')
      : renderOpportunityCard(null);
    const output = opportunityOutput(topOpportunity);
    const primaryAction = topOpportunity
      ? output.artifact
        ? `<button class="button button--primary button--full" data-action="go-artifact" data-id="${output.artifact.id}">处理最高优先机会 ${icon('arrow')}</button>`
        : `<button class="button button--primary button--full" data-action="open-opportunity" data-id="${topOpportunity.id}">处理最高优先机会 ${icon('arrow')}</button>`
      : `<button class="button button--secondary button--full" data-action="open-page" data-id="${item.id}">查看完整页面证据 ${icon('arrow')}</button>`;
    return `<aside class="panel v13-detail-panel v14-url-detail" data-selected-page-id="${item.id}" aria-live="polite" aria-atomic="true"><header class="v14-detail-header"><div><span class="eyebrow">当前 URL · ${item.priority.toUpperCase()}</span><h2>${escapeHtml(item.path)}</h2><p>${escapeHtml(item.title)}</p></div><button class="v14-external-button" data-action="open-page" data-id="${item.id}" aria-label="打开 ${escapeHtml(item.path)} 的完整证据">${icon('external')}</button></header><div class="v14-detail-metrics"><div><span>${workspace.results.currentWindow.days} 天自然搜索点击</span><strong>${item.clicks === null ? '—' : compact(item.clicks)}</strong></div><div><span>平均排名</span><strong>${item.avgPosition === null ? '—' : item.avgPosition.toFixed(1)}</strong></div><div><span>主题簇</span><strong>${escapeHtml(item.cluster?.slug || item.cluster?.label || '—')}</strong></div></div><section class="v14-detail-section"><div><h3>当前问题与机会</h3><span>${item.opportunities.length} 条</span></div><div class="v14-opportunity-list">${opportunityCards}</div></section><div class="v14-detail-primary">${primaryAction}</div></aside>`;
  }

  function clusterGrowthNode(cluster, pageNodes) {
    const pages = pageNodes.filter((item) => item.clusterId === cluster.id);
    const pageIds = new Set(pages.map((item) => item.id));
    const keywords = workspace.keywords.filter((item) => item.clusterId === cluster.id);
    const rankedKeywords = keywords.filter((item) => Number.isFinite(item.currentRank));
    const opportunities = sortOpportunities(workspace.opportunities
      .filter((item) => !['closed', 'dismissed'].includes(item.status) && item.urlIds.some((id) => pageIds.has(id)))
      .map((item) => ({
        ...item,
        urlIds: item.urlIds.filter((id) => pageIds.has(id)),
        findingIds: item.findingIds.filter((id) => byId(workspace.findings, id)?.urlIds.some((urlId) => pageIds.has(urlId))),
        artifactIds: item.artifactIds.filter((id) => byId(workspace.artifacts, id)?.targetUrlIds.some((urlId) => pageIds.has(urlId))),
      })));
    return { ...cluster, pages, keywords, opportunities, clicks: pages.reduce((sum, item) => sum + (item.clicks || 0), 0), avgPosition: rankedKeywords.length ? rankedKeywords.reduce((sum, item) => sum + item.currentRank, 0) / rankedKeywords.length : null, topOpportunity: opportunities[0] || null };
  }

  function renderClusterPageView(pageNodes) {
    const query = state.searches.pages.trim().toLowerCase();
    const scopedPages = state.pageTypeFilter === 'all' ? pageNodes : pageNodes.filter((page) => page.pageType === state.pageTypeFilter);
    const scopedPageIds = new Set(scopedPages.map((page) => page.id));
    const clusters = workspace.clusters.map((cluster) => {
      const node = clusterGrowthNode(cluster, scopedPages);
      if (state.pageTypeFilter !== 'all') {
        node.keywords = node.keywords.filter((keyword) => scopedPageIds.has(keyword.mappedUrlId));
        const rankedKeywords = node.keywords.filter((keyword) => Number.isFinite(keyword.currentRank));
        node.avgPosition = rankedKeywords.length
          ? rankedKeywords.reduce((sum, keyword) => sum + keyword.currentRank, 0) / rankedKeywords.length
          : null;
      }
      return node;
    }).filter((item) => item.pages.length > 0 && (!query || `${item.label} ${item.role} ${item.pages.map((page) => `${page.path} ${page.title}`).join(' ')}`.toLowerCase().includes(query)));
    const page = paginate('pages', clusters);
    if (!page.rows.some((item) => item.id === state.selectedClusterId)) state.selectedClusterId = page.rows[0]?.id || clusters[0]?.id;
    const selected = clusters.find((item) => item.id === state.selectedClusterId);
    return `<section class="v13-master-detail v14-page-layout"><div class="panel v13-table-card v14-page-table-card"><div class="client-table-scroll"><table class="client-table v13-table v14-page-table v14-cluster-table"><thead><tr><th>主题簇</th><th>角色</th><th>URL 数量</th><th>关键词</th><th>点击量</th><th>开放机会</th></tr></thead><tbody>${page.rows.map((item) => `<tr class="${item.id === selected?.id ? 'is-selected' : ''}" data-action="select-map-cluster" data-id="${item.id}" tabindex="0" aria-selected="${item.id === selected?.id}" aria-label="选择主题簇 ${escapeHtml(item.label)}"><td data-label="主题簇"><div class="client-primary-cell"><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.slug)}</small></div></td><td data-label="角色">${escapeHtml(item.roleLabel || item.role.replaceAll('_', ' '))}</td><td data-label="URL 数量"><strong>${item.pages.length}</strong></td><td data-label="关键词"><strong>${item.keywords.length}</strong></td><td data-label="点击量"><strong>${item.clicks ? compact(item.clicks) : '—'}</strong><small>${workspace.results.currentWindow.days} 天</small></td><td data-label="开放机会">${badge(`${item.opportunities.length} 个`, item.opportunities.length ? 'warning' : 'success')}</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty-state">没有匹配的主题簇。</div></td></tr>'}</tbody></table></div>${page.totalPages > 1 ? tablePager('pages', page) : ''}</div>${selected ? renderClusterDetailPanel(selected) : '<aside class="panel v13-detail-panel v14-url-detail"><div class="empty-state">请选择一个主题簇。</div></aside>'}</section>`;
  }

  function renderClusterDetailPanel(item) {
    const cta = workspace.project.conversionGoals.find((goal) => goal.id === item.primaryCtaId);
    const generativeQueries = item.generativeQueries || [];
    return `<aside class="panel v13-detail-panel v14-url-detail"><header class="v14-detail-header"><div><span class="eyebrow">主题簇</span><h2>${escapeHtml(item.label)}</h2><p>${escapeHtml(item.roleLabel || item.role.replaceAll('_', ' '))}</p></div>${badge(`${item.opportunities.length} 个开放机会`, item.opportunities.length ? 'warning' : 'success')}</header><div class="v14-detail-metrics"><div><span>现有页面</span><strong>${item.pages.length}</strong></div><div><span>搜索查询</span><strong>${item.keywords.length}</strong></div><div><span>生成式查询</span><strong>${generativeQueries.length}</strong></div></div><section class="v14-detail-section"><div><h3>现有页面与角色</h3><span>${item.pages.length} 项</span></div><div class="v14-object-list">${item.pages.slice(0, 6).map((page) => `<button data-action="open-cluster-page" data-id="${page.id}"><span><strong>${escapeHtml(page.path)}</strong><small>${escapeHtml(page.pageType === 'blog' ? '博客页' : pageTypeLabels[page.pageType] || page.pageType)} · ${escapeHtml(page.title)}</small></span>${icon('arrow')}</button>`).join('')}</div></section><section class="v14-detail-section"><div><h3>搜索查询</h3><span>${item.keywords.length} 个查询</span></div><div class="client-chip-row">${item.keywords.slice(0, 6).map((keyword) => `<span>${escapeHtml(keyword.text)}</span>`).join('') || '<span>暂无映射查询</span>'}</div></section><section class="v14-detail-section"><div><h3>生成式查询</h3><span>${generativeQueries.length} 个提示词</span></div><ul class="v14-query-list">${generativeQueries.map((query) => `<li>${escapeHtml(query)}</li>`).join('') || '<li>当前固定查询集尚未覆盖该主题。</li>'}</ul></section><section class="v14-cluster-decision"><div><span>覆盖缺口</span><strong>${escapeHtml(item.coverageGap || '当前范围未发现明确覆盖缺口。')}</strong></div><div><span>主要 CTA</span><strong>${escapeHtml(cta?.label || '尚未映射')}</strong><small>${escapeHtml(cta?.eventName || '未连接事件')}</small></div></section><section class="v14-detail-section"><div><h3>最高优先机会</h3></div>${renderOpportunityCard(item.topOpportunity)}</section></aside>`;
  }

  function renderOpportunityPageView(pageNodes) {
    const query = state.searches.pages.trim().toLowerCase();
    const opportunities = sortOpportunities(workspace.opportunities.filter((item) => !['closed', 'dismissed'].includes(item.status))).map((item) => {
      const scopedUrls = item.urlIds.map((id) => pageNodes.find((page) => page.id === id)).filter((page) => page && (state.pageTypeFilter === 'all' || page.pageType === state.pageTypeFilter));
      const scopedUrlIds = scopedUrls.map((page) => page.id);
      const artifactIds = item.artifactIds.filter((id) => byId(workspace.artifacts, id)?.targetUrlIds.some((urlId) => scopedUrlIds.includes(urlId)));
      const findingIds = item.findingIds.filter((id) => byId(workspace.findings, id)?.urlIds.some((urlId) => scopedUrlIds.includes(urlId)));
      return { ...item, urlIds: scopedUrlIds, artifactIds, findingIds, scopedUrls };
    }).filter((item) => item.urlIds.length > 0 && (!query || `${item.title} ${labels.lens[item.lens]} ${item.scopedUrls.map((url) => `${url.path} ${url.title}`).join(' ')}`.toLowerCase().includes(query)));
    const page = paginate('pages', opportunities);
    if (!page.rows.some((item) => item.id === state.selectedOpportunityId)) state.selectedOpportunityId = page.rows[0]?.id || opportunities[0]?.id;
    const selected = opportunities.find((item) => item.id === state.selectedOpportunityId);
    return `<section class="v13-master-detail v14-page-layout"><div class="panel v13-table-card v14-page-table-card"><div class="client-table-scroll"><table class="client-table v13-table v14-page-table v14-opportunity-table"><thead><tr><th>机会 / 目标</th><th>类型</th><th>优先级</th><th>URLs</th><th>交付物</th><th>状态</th></tr></thead><tbody>${page.rows.map((item) => `<tr class="${item.id === selected?.id ? 'is-selected' : ''}" data-action="select-map-opportunity" data-id="${item.id}" tabindex="0" aria-selected="${item.id === selected?.id}" aria-label="选择机会 ${escapeHtml(item.title)}"><td data-label="机会 / 目标"><div class="client-primary-cell"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.urlIds.map(urlName).join(' · '))}</small></div></td><td data-label="类型">${escapeHtml(labels.lens[item.lens])}</td><td data-label="优先级"><strong>${item.priority.toUpperCase()}</strong></td><td data-label="URLs"><strong>${item.urlIds.length}</strong></td><td data-label="交付物"><strong>${item.artifactIds.length}</strong></td><td data-label="状态">${badge(statusLabel('opportunityStatus', item.status), toneFor(item.status))}</td></tr>`).join('') || '<tr><td colspan="6"><div class="empty-state">没有匹配的机会。</div></td></tr>'}</tbody></table></div>${page.totalPages > 1 ? tablePager('pages', page) : ''}</div>${selected ? renderOpportunityDetailPanel(selected) : '<aside class="panel v13-detail-panel v14-url-detail"><div class="empty-state">请选择一个机会。</div></aside>'}</section>`;
  }

  function renderOpportunityDetailPanel(item) {
    const findings = item.findingIds.map((id) => byId(workspace.findings, id)).filter(Boolean);
    const artifacts = item.artifactIds.map((id) => byId(workspace.artifacts, id)).filter(Boolean);
    const output = opportunityOutput(item);
    const primaryFinding = findings[0];
    const limitations = item.coverageAndLimitations || [`证据只覆盖 ${item.urlIds.length} 个当前目标 URL`, '需要在下一次数据更新后重新检查数据新鲜度'];
    const workShape = item.workShape || (item.lens === 'webtech' ? '修复' : item.lens === 'landing' ? '优化' : '创建');
    const nextDecision = item.nextDecision || (output.artifact ? '查看交付物并完成当前审核决定' : '确认主要问题后生成正式交付物');
    return `<aside class="panel v13-detail-panel v14-url-detail"><header class="v14-detail-header"><div><span class="eyebrow">增长机会 · ${item.priority.toUpperCase()}</span><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(labels.lens[item.lens])} · ${escapeHtml(workShape)}${item.targetKind === 'template' ? ` · 页面模板 ${escapeHtml(item.templateKey)}` : ''}</p></div>${badge(statusLabel('opportunityStatus', item.status), toneFor(item.status))}</header><div class="v14-detail-metrics"><div><span>目标 URLs</span><strong>${item.urlIds.length}</strong></div><div><span>问题证据</span><strong>${findings.length}</strong></div><div><span>交付物</span><strong>${artifacts.length}</strong></div></div><section class="v14-detail-section"><div><h3>主要 Finding</h3><span>${primaryFinding ? primaryFinding.severity.toUpperCase() : '待建立'}</span></div><div class="v14-primary-finding"><strong>${escapeHtml(primaryFinding?.title || '当前尚未绑定主要 Finding')}</strong><p>${primaryFinding ? primaryFinding.sourceRefs.map(sourceName).join(' · ') : '需要补充证据后再进入决策。'}</p></div></section><section class="v14-detail-section"><div><h3>支撑证据</h3><span>${findings.length} 条记录</span></div><div class="client-chip-row">${findings.flatMap((finding) => finding.sourceRefs).filter((value, index, list) => list.indexOf(value) === index).map((sourceId) => `<span>${escapeHtml(sourceName(sourceId))}</span>`).join('')}</div></section><section class="v14-detail-section"><div><h3>目标页面</h3><span>${item.urlIds.length} 项</span></div><div class="v14-object-list">${item.urlIds.map((id) => { const page = byId(workspace.urls, id); return `<button data-action="open-opportunity-page" data-id="${id}"><span><strong>${escapeHtml(page?.path || id)}</strong><small>${escapeHtml(page?.title || '')}</small></span>${icon('arrow')}</button>`; }).join('')}</div></section><section class="v14-detail-section"><div><h3>覆盖范围与限制</h3></div><ul class="v14-query-list">${limitations.map((limitation) => `<li>${escapeHtml(limitation)}</li>`).join('')}</ul></section><section class="v14-detail-section"><div><h3>执行输出</h3></div><div class="v14-output-card"><span>${escapeHtml(output.label)}</span><strong>${escapeHtml(output.artifact?.title || '尚未创建正式交付物')}</strong><small>${output.artifact ? statusLabel('artifactStatus', output.artifact.status) : '机会证据已建立，可以创建客户可审核的执行物'}</small></div></section><section class="v14-next-decision"><span>下一步决定</span><strong>${escapeHtml(nextDecision)}</strong><button class="button button--secondary button--full" data-action="decide-opportunity" data-id="${item.id}">记录机会决定</button></section><div class="v14-detail-primary">${output.artifact ? `<button class="button button--primary button--full" data-action="go-artifact" data-id="${output.artifact.id}">打开交付物 ${icon('arrow')}</button>` : `<button class="button button--primary button--full" data-action="create-artifact" data-id="${item.id}">创建执行物 ${icon('arrow')}</button>`}</div></aside>`;
  }

  function renderKeywordLibrary() {
    const rows = filterRows('keywords', workspace.keywords);
    const page = paginate('keywords', rows);
    if (!page.rows.some((item) => item.id === state.selectedKeywordId)) state.selectedKeywordId = page.rows[0]?.id || rows[0]?.id;
    const selected = byId(workspace.keywords, state.selectedKeywordId);
    const intentLabels = { commercial: '商业意图', informational: '信息意图', comparison: '对比意图', implementation: '实施意图' };
    const sourceLabels = { competitor_gap: '竞品关键词缺口', content_gap: '内容缺口', suggest_paa: '种子词 + 搜索建议 / PAA', community_voc: '社区 / VOC', trend_signal: '趋势信号', gsc_unexpected: 'GSC 意外词', manual_csv: '手动 / CSV', manual: '手动添加' };
    const counts = workspace.keywords.reduce((result, item) => { result[item.sourceKind] = (result[item.sourceKind] || 0) + 1; return result; }, {});
    const sourceEntries = Object.entries(keywordSourceMeta).filter(([key]) => counts[key]);
    const sourceOptions = sourceEntries.map(([key, meta]) => `<option value="${key}" ${state.keywordSource === key ? 'selected' : ''}>${escapeHtml(sourceLabels[key] || meta.label)}</option>`).join('');
    return `<section class="v13-source-strip"><div class="v13-source-strip__intro"><span class="eyebrow">入库路径</span><strong>每个关键词都保留入库路径、映射关系与当前状态</strong><p>关键词不会自动变成孤立文章，而是先进入主题簇，再确定页面、CTA 与交付物。</p></div><div class="v13-source-strip__items"><button class="v13-source-chip ${state.keywordSource === 'all' ? 'is-active' : ''}" data-action="keyword-source" data-source="all"><span class="source-dot tone-green"></span><span><strong>全部来源</strong><small>${workspace.keywords.length} 个关键词</small></span></button>${sourceEntries.map(([key, meta]) => `<button class="v13-source-chip ${state.keywordSource === key ? 'is-active' : ''}" data-action="keyword-source" data-source="${key}"><span class="source-dot tone-${meta.tone}"></span><span><strong>${escapeHtml(sourceLabels[key] || meta.label)}</strong><small>${counts[key]} 个关键词</small></span></button>`).join('')}</div></section>
      <div class="client-library-toolbar v13-library-toolbar"><label class="client-search">${icon('search')}<input type="search" data-search="keywords" value="${escapeHtml(state.searches.keywords)}" placeholder="搜索关键词或主题簇" aria-label="搜索关键词或主题簇"></label><label class="client-select-label"><span>入库路径</span><select data-source-filter="keywords"><option value="all">全部来源</option>${sourceOptions}</select></label><button class="button button--primary button--small" data-action="add-keyword">添加关键词</button></div>
      <section class="v13-master-detail"><div class="panel v13-table-card"><div class="client-table-scroll"><table class="client-table v13-table client-keyword-table"><thead><tr><th>关键词</th><th>搜索意图</th><th>搜索量</th><th>KD</th><th>排名 / URL</th><th>入库路径</th><th>数据新鲜度</th><th>状态</th><th></th></tr></thead><tbody>${page.rows.map((item) => { const cluster = byId(workspace.clusters, item.clusterId); const source = keywordSourceMeta[item.sourceKind] || keywordSourceMeta.manual; const sourceLabel = sourceLabels[item.sourceKind] || source.label; const freshness = sourceFreshness(item.sourceRefs); return `<tr class="${item.id === selected?.id ? 'is-selected' : ''}"><td data-label="关键词"><button class="client-primary-cell" data-action="select-map-keyword" data-id="${item.id}"><strong>${escapeHtml(item.text)}</strong><small>${escapeHtml(cluster?.label || '未分组')}</small></button></td><td data-label="搜索意图"><strong>${escapeHtml(intentLabels[item.intent] || item.intent)}</strong><small>${item.market}</small></td><td data-label="搜索量"><strong>${metricValue(item.volume, '未连接')}</strong></td><td data-label="KD"><strong>${item.difficulty ?? '不可用'}</strong></td><td data-label="排名 / URL"><strong>${item.currentRank ?? '未覆盖'}</strong><small>${escapeHtml(item.mappedUrlId ? urlName(item.mappedUrlId) : '新内容')}</small></td><td data-label="入库路径"><strong>${escapeHtml(sourceLabel)}</strong></td><td data-label="数据新鲜度"><strong>${escapeHtml(freshness.label)}</strong></td><td data-label="状态">${badge(statusLabel('keywordStatus', item.status), toneFor(item.status))}</td><td><button class="row-arrow" data-action="open-keyword" data-id="${item.id}" aria-label="打开关键词完整详情">${icon('arrow')}</button></td></tr>`; }).join('') || '<tr><td colspan="9"><div class="empty-state">没有匹配的关键词。</div></td></tr>'}</tbody></table></div>${tablePager('keywords', page)}</div>${selected ? renderKeywordDetailPanel(selected) : '<aside class="panel v13-detail-panel"><div class="empty-state">请选择一个关键词。</div></aside>'}</section>`;
  }

  function renderKeywordDetailPanel(item) {
    const cluster = byId(workspace.clusters, item.clusterId);
    const mapped = byId(workspace.urls, item.mappedUrlId);
    const related = workspace.keywords.filter((keyword) => keyword.clusterId === item.clusterId && keyword.id !== item.id).slice(0, 4);
    const source = keywordSourceMeta[item.sourceKind] || keywordSourceMeta.manual;
    const sourceLabels = { competitor_gap: '竞品关键词缺口', content_gap: '内容缺口', suggest_paa: '种子词 + 搜索建议 / PAA', community_voc: '社区 / VOC', trend_signal: '趋势信号', gsc_unexpected: 'GSC 意外词', manual_csv: '手动 / CSV', manual: '手动添加' };
    const intentLabels = { commercial: '商业意图', informational: '信息意图', comparison: '对比意图', implementation: '实施意图' };
    const cta = workspace.project.conversionGoals.find((goal) => goal.id === item.ctaId);
    const visibleSources = item.sourceRefs.map((id) => byId(workspace.dataSources, id)).filter((entry) => entry?.audienceVisibility === 'customer');
    const freshness = sourceFreshness(item.sourceRefs);
    return `<aside class="panel v13-detail-panel"><header class="v13-detail-header"><div><span class="eyebrow">关键词详情</span><h2>${escapeHtml(item.text)}</h2><p>${escapeHtml(cluster?.label || '未分组')} · ${escapeHtml(intentLabels[item.intent] || item.intent)}</p></div>${badge(statusLabel('keywordStatus', item.status), toneFor(item.status))}</header><div class="v13-detail-metrics v13-detail-metrics--four"><div><span>美国搜索量</span><strong>${metricValue(item.volume, '未连接')}</strong></div><div><span>KD</span><strong>${item.difficulty ?? '不可用'}</strong></div><div><span>当前排名</span><strong>${item.currentRank ?? '未覆盖'}</strong></div><div><span>数据新鲜度</span><strong>${escapeHtml(freshness.label)}</strong></div></div><section class="v13-route-card"><span>入库路径</span><strong>${escapeHtml(sourceLabels[item.sourceKind] || source.label)}</strong><p>${visibleSources.length ? `已关联 ${visibleSources.map((entry) => entry.name).join('、')}` : `${internalSignalCount(item.sourceRefs)} 条系统内置信号`}；保留标准化、去重和 ICP / JTBD 相关性结果。</p></section><section class="v13-detail-section"><div class="v13-detail-section__heading"><h3>主题簇承接与转化路径</h3></div><div class="v13-cluster-path"><div><span>01</span><small>主题簇</small><strong>${escapeHtml(cluster?.label || '—')}</strong></div><i>${icon('arrow')}</i><div><span>02</span><small>映射页面</small><strong>${escapeHtml(mapped?.path || '新内容')}</strong></div><i>${icon('arrow')}</i><div><span>03</span><small>CTA</small><strong>${escapeHtml(cta?.label || '—')}</strong></div></div></section><section class="v13-detail-section"><div class="v13-detail-section__heading"><h3>同主题簇需求信号</h3><span>显示 ${related.length} 项</span></div><div class="v13-related-list">${related.map((keyword) => `<button data-action="select-map-keyword" data-id="${keyword.id}"><strong>${escapeHtml(keyword.text)}</strong><small>${intentLabels[keyword.intent] || keyword.intent} · 搜索量 ${metricValue(keyword.volume, '未连接')}</small>${icon('arrow')}</button>`).join('')}</div></section><div class="v13-detail-actions"><button class="button button--secondary" data-action="open-keyword" data-id="${item.id}">查看来源与明细</button><button class="button button--primary" data-action="go-keyword-artifact" data-cluster="${item.clusterId}">打开相关交付物</button></div></aside>`;
  }

  function renderCompetitorLibrary() {
    const rows = filterRows('competitors', workspace.competitors);
    const page = paginate('competitors', rows);
    if (!page.rows.some((item) => item.id === state.selectedCompetitorId)) state.selectedCompetitorId = page.rows[0]?.id || rows[0]?.id;
    const selected = byId(workspace.competitors, state.selectedCompetitorId);
    const extra = '<button class="button button--primary button--small" data-action="add-competitor">添加竞品</button>';
    const discoveryRoutes = [['客户与销售输入', workspace.competitors.filter((item) => item.sourceRefs.includes('src-customer-notes')).length], ['搜索结果中的重复域名', workspace.competitors.filter((item) => item.sourceRefs.includes('src-serp')).length], ['AI 共同引用', workspace.competitors.filter((item) => item.sourceRefs.includes('src-ai-answers')).length], ['已批准语料库', workspace.competitors.filter((item) => item.sourceRefs.includes('src-competitor-corpus')).length]];
    return `<section class="v13-source-strip v13-source-strip--compact"><div class="v13-source-strip__intro"><span class="eyebrow">发现路径</span><strong>先建立大的竞品池，再由客户确认分析范围</strong><p>候选竞品不会自动进入关键词缺口分析；只有审核通过且范围允许的域名才参与正式比较。</p></div><div class="v13-source-strip__items">${discoveryRoutes.map(([label, count], index) => `<div class="v13-source-chip"><span class="source-dot tone-${['amber', 'teal', 'violet', 'blue'][index]}"></span><span><strong>${label}</strong><small>${count} 个域名</small></span></div>`).join('')}</div></section>${libraryToolbar('competitors', '搜索公司或域名', [['candidate', '候选'], ['approved', '已确认'], ['excluded', '已排除']], extra)}
      <section class="v13-master-detail"><div class="panel v13-table-card"><div class="client-table-scroll"><table class="client-table v13-table client-competitor-table"><thead><tr><th>竞品</th><th>关系</th><th>分析范围</th><th>自然搜索重叠度</th><th>共同关键词</th><th>AI 引用</th><th>状态</th><th></th></tr></thead><tbody>${page.rows.map((item) => `<tr class="${item.id === selected?.id ? 'is-selected' : ''}"><td data-label="竞品"><button class="client-primary-cell" data-action="select-map-competitor" data-id="${item.id}"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.domain)}</small></button></td><td data-label="关系">${escapeHtml(relationLabels[item.relation] || item.relation)}</td><td data-label="分析范围">${escapeHtml(scopeLabels[item.analysisScope] || item.analysisScope)}</td><td data-label="自然搜索重叠度"><strong>${item.organicOverlapPct == null ? '数据不足' : `${item.organicOverlapPct}%`}</strong></td><td data-label="共同关键词"><strong>${metricValue(item.sharedKeywordCount, '采集中')}</strong></td><td data-label="AI 引用"><strong>${item.aiCitationCount == null ? '不可用' : `${item.aiCitationCount}/20`}</strong></td><td data-label="状态">${badge(statusLabel('competitorStatus', item.status), toneFor(item.status))}</td><td><button class="row-arrow" data-action="open-competitor" data-id="${item.id}" aria-label="打开竞品完整详情">${icon('arrow')}</button></td></tr>`).join('') || '<tr><td colspan="8"><div class="empty-state">没有匹配的竞品。</div></td></tr>'}</tbody></table></div>${tablePager('competitors', page)}</div>${selected ? renderCompetitorDetailPanel(selected) : '<aside class="panel v13-detail-panel"><div class="empty-state">请选择一个竞品。</div></aside>'}</section>`;
  }

  function renderCompetitorDetailPanel(item) {
    const participates = item.status === 'approved' && item.analysisScope !== 'excluded';
    const reason = item.sourceRefs.includes('src-customer-notes') ? '客户与市场信号共同确认该域名与当前采购场景有关。' : item.organicOverlapPct == null ? '该域名由客户手动加入；外部差距指标将在下一次数据更新后生成。' : `该域名因 ${item.organicOverlapPct}% 自然搜索重叠度与 ${compact(item.sharedKeywordCount)} 个共同关键词进入竞品池。`;
    return `<aside class="panel v13-detail-panel"><header class="v13-detail-header"><div><span class="eyebrow">竞品档案</span><h2>${escapeHtml(item.name)}</h2><p>${escapeHtml(item.domain)} · ${escapeHtml(relationLabels[item.relation] || item.relation)}</p></div>${badge(statusLabel('competitorStatus', item.status), toneFor(item.status))}</header><section class="v13-route-card ${item.status === 'candidate' ? 'is-warning' : ''}"><span>为什么进入竞品池</span><p>${escapeHtml(reason)}</p></section><div class="v13-detail-metrics v13-detail-metrics--four"><div><span>自然搜索重叠度</span><strong>${item.organicOverlapPct == null ? '数据不足' : `${item.organicOverlapPct}%`}</strong></div><div><span>共同关键词</span><strong>${metricValue(item.sharedKeywordCount, '采集中')}</strong></div><div><span>AI 引用</span><strong>${item.aiCitationCount == null ? '不可用' : item.aiCitationCount}</strong></div><div><span>证据</span><strong>${item.sourceRefs.length}</strong></div></div><dl class="v13-detail-facts"><div><dt>竞争关系</dt><dd>${escapeHtml(relationLabels[item.relation] || item.relation)}</dd></div><div><dt>分析范围</dt><dd>${escapeHtml(scopeLabels[item.analysisScope] || item.analysisScope)}</dd></div><div><dt>关键词缺口</dt><dd>${participates ? '已纳入正式分析' : item.status === 'candidate' ? '等待客户确认' : '不参与'}</dd></div><div><dt>系统证据</dt><dd>${internalSignalCount(item.sourceRefs)} 条内置溯源证据</dd></div></dl><div class="v13-detail-actions"><button class="button button--secondary" data-action="open-competitor" data-id="${item.id}">查看完整档案</button><button class="button button--primary" data-action="review-competitor" data-id="${item.id}">${item.status === 'candidate' ? '审核竞品范围' : '调整分析范围'}</button></div></aside>`;
  }

  function renderExecution() {
    const filterConfig = [
      ['all', '全部任务', () => true],
      ['blog', 'English Blog', (item) => item.type === 'english_blog_draft'],
      ['brief', '内容 / 竞品 Brief', (item) => ['content_brief', 'comparison_brief'].includes(item.type)],
      ['code', '技术工单 / 代码 / Schema', (item) => ['technical_ticket', 'code_patch', 'schema_patch'].includes(item.type)],
      ['metadata', 'Metadata 重写', (item) => item.type === 'metadata_rewrite'],
      ['landing', 'Landing / UTM 追踪', (item) => ['landing_revision', 'utm_plan'].includes(item.type)],
      ['publish', '发布回执', (item) => item.type === 'publish_receipt'],
    ];
    const filterGroups = Object.fromEntries(filterConfig.map(([key, , predicate]) => [key, workspace.artifacts.filter(predicate)]));
    const items = filterGroups[state.artifactFilter] || filterGroups.all;
    if (!items.some((item) => item.id === state.selectedArtifactId)) state.selectedArtifactId = items[0]?.id || workspace.artifacts[0]?.id;
    const selected = byId(workspace.artifacts, state.selectedArtifactId);
    const reviewCount = workspace.artifacts.filter((item) => item.status === 'review').length;
    return `${pageHeader('执行中心', '直接查看并处理交付物', '每个任务都来自增长地图中的已确认问题或机会。这里直接呈现 Technical Ticket、English Blog、内容 Brief、Metadata、代码修复、Landing、UTM Plan 与发布回执。', '<button class="button button--secondary" data-action="nav" data-route="growth-map">返回增长地图</button>')}
      <section class="panel v13-execution-toolbar"><div role="tablist" aria-label="按交付物类型筛选">${filterConfig.map(([key, label]) => `<button id="tab-artifact-${key}" role="tab" aria-controls="artifact-workspace" aria-selected="${state.artifactFilter === key}" tabindex="${state.artifactFilter === key ? '0' : '-1'}" class="${state.artifactFilter === key ? 'is-active' : ''}" data-action="artifact-filter" data-filter="${key}">${label}</button>`).join('')}</div><span>共 ${workspace.artifacts.length} 项 · ${reviewCount} 个需要你的审核</span></section>
      <div id="artifact-workspace" role="tabpanel" aria-labelledby="tab-artifact-${state.artifactFilter}" class="client-execution-shell v13-execution-shell">
        <aside class="panel client-work-queue">
          <header class="v13-work-queue-header"><div><span class="eyebrow">执行队列</span><h2>当前交付物</h2></div><span>${items.length}</span></header>
          <div class="client-work-list">${items.map((item) => `<button class="client-work-item v13-work-item ${item.id === state.selectedArtifactId ? 'is-active' : ''}" data-action="select-artifact" data-id="${item.id}"><span class="v13-work-item__mark">${item.type === 'english_blog_draft' ? 'EN' : item.type === 'content_brief' || item.type === 'comparison_brief' ? 'BR' : item.type === 'technical_ticket' ? 'TK' : item.type === 'code_patch' || item.type === 'schema_patch' ? '&lt;/&gt;' : item.type === 'metadata_rewrite' ? 'MD' : item.type === 'utm_plan' ? 'UTM' : item.type === 'landing_revision' ? 'LP' : 'PR'}</span><span class="v13-work-item__copy"><span class="client-work-type">${escapeHtml(artifactTypeLabels[item.type] || item.type)}</span><strong>${escapeHtml(item.title)}</strong><small>v${item.revision} · ${item.targetUrlIds.map(urlName).join(', ')}</small>${badge(statusLabel('artifactStatus', item.status), toneFor(item.status))}</span></button>`).join('') || '<div class="empty-state">当前筛选没有交付物。</div>'}</div>
        </aside>
        <article class="panel client-artifact-document">${selected ? renderArtifact(selected) : '<div class="empty-state">请选择一个交付物。</div>'}</article>
      </div>`;
  }

  function renderArtifact(item) {
    const opportunity = byId(workspace.opportunities, item.opportunityId);
    const missingGates = item.requiredGates.filter((gate) => !item.passedGates.includes(gate));
    const canApprove = item.status === 'review' && missingGates.every((gate) => gate === 'human');
    const canPublish = item.status === 'approved' && missingGates.length === 0;
    const receipt = workspace.releases.find((release) => release.artifactId === item.id);
    const readiness = Math.round((item.passedGates.length / Math.max(1, item.requiredGates.length)) * 100);
    const observation = workspace.results.pageObservations.find((result) => item.targetUrlIds.includes(result.urlId));
    const publicSources = item.sourceRefs.map((id) => byId(workspace.dataSources, id)).filter((source) => source?.audienceVisibility === 'customer');
    const owner = item.owner || artifactOwners[item.type] || '增长运营';
    const acceptance = `${item.passedGates.length}/${item.requiredGates.length} 个门禁`;
    return `<header class="client-document-header v13-document-header">
        <div><div class="v13-document-kicker"><span class="eyebrow">${escapeHtml(artifactTypeLabels[item.type] || item.type)} · Revision ${item.revision}</span>${badge(statusLabel('artifactStatus', item.status), toneFor(item.status))}</div><h2>${escapeHtml(item.title)}</h2><p>${escapeHtml(labels.lens[opportunity?.lens] || '增长机会')} · ${escapeHtml(opportunity?.id || '—')} · ${item.targetUrlIds.map((id) => `<code>${escapeHtml(urlName(id))}</code>`).join(' ')}</p></div>
        <div class="client-document-actions"><button class="button button--secondary button--small" data-action="share-artifact" data-id="${item.id}">${icon('link')} 模拟分享</button><button class="button button--secondary button--small" data-action="open-artifact-history" data-id="${item.id}">版本历史</button>${item.type !== 'publish_receipt' ? `<button class="button button--secondary button--small" data-action="edit-artifact" data-id="${item.id}">创建新 Revision</button>` : ''}${item.status === 'review' ? `<button class="button button--primary button--small" data-action="approve-artifact" data-id="${item.id}" ${canApprove ? '' : 'disabled'}>批准</button>` : ''}${canPublish ? `<button class="button button--primary button--small" data-action="publish-artifact" data-id="${item.id}">模拟发布</button>` : ''}${item.status === 'published' || receipt ? `<button class="button button--secondary button--small" data-action="open-receipt" data-id="${item.id}">${item.approvalInvalidatedAt ? '查看历史模拟回执' : '查看模拟回执'}</button>` : ''}</div>
      </header>
      <section class="client-artifact-meta" aria-label="交付治理信息"><div><span>关联目标</span><strong>${item.targetUrlIds.map(urlName).join(' · ')}</strong></div><div><span>执行动作</span><strong>${escapeHtml(opportunity?.title || '未绑定')}</strong></div><div><span>负责人</span><strong>${escapeHtml(owner)}</strong></div><div><span>验收门禁</span><strong>${escapeHtml(acceptance)}</strong></div></section>
      ${item.approvalInvalidatedAt ? `<div class="client-approval-invalidated"><strong>旧版批准已失效</strong><span>Revision ${item.revision} 修改了客户可见内容，需要重新完成人工审核门禁。历史发布记录仍保留，不会被覆盖。</span></div>` : ''}
      <div class="v13-document-grid"><div class="client-document-body v13-document-body">${item.revisionNote ? `<section class="client-revision-note"><span>Revision ${item.revision} 修订摘要</span><strong>${escapeHtml(item.revisionNote)}</strong><small>${escapeHtml(item.changeNote || '客户可见正文已创建新版本。')}</small></section>` : ''}${item.type === 'english_blog_draft' ? `<div class="v13-seo-title"><span>SEO 标题 · 57 个字符</span><strong>${escapeHtml(item.title)}</strong></div><div class="v13-byline"><span>RO</span><div><strong>RelayOps 编辑团队</strong><small>Revision ${item.revision} · ${item.sourceRefs.length} 条已批准证据</small></div></div>` : ''}${artifactDocument(item)}</div><aside class="v13-quality-panel"><div class="v13-quality-score"><span>交付就绪度</span><strong>${readiness}</strong><small>/ 100</small></div><section><h3>质量检查</h3>${item.requiredGates.map((gate) => { const passed = item.passedGates.includes(gate); return `<div class="v13-quality-gate ${passed ? 'is-passed' : 'is-pending'}"><span>${passed ? icon('check') : '!'}</span><div><small>${escapeHtml(qualityGateLabels[gate] || gate)}</small><strong>${passed ? '已通过' : '等待补充'}</strong></div></div>`; }).join('')}</section>${missingGates.length && !canApprove ? `<div class="v13-quality-blocker"><strong>当前不能批准</strong><p>仍需通过：${missingGates.map((gate) => qualityGateLabels[gate] || gate).join('、')}</p></div>` : ''}<section><h3>证据与范围</h3><button class="v13-quality-link" data-action="open-opportunity" data-id="${opportunity?.id}"><span>来源机会</span><strong>${escapeHtml(opportunity?.title || '—')}</strong>${icon('arrow')}</button><dl class="v13-quality-facts"><div><dt>目标 URLs</dt><dd>${item.targetUrlIds.length}</dd></div><div><dt>证据</dt><dd>${item.sourceRefs.length} 条</dd></div><div><dt>客户连接</dt><dd>${publicSources.map((source) => source.name).join(' · ') || '不依赖外部连接'}</dd></div><div><dt>系统证据</dt><dd>${internalSignalCount(item.sourceRefs)} 条信号</dd></div></dl></section><section><h3>发布与结果</h3>${receipt ? `<dl class="v13-quality-facts"><div><dt>${item.approvalInvalidatedAt ? '历史发布' : '发布版本'}</dt><dd>${escapeHtml(receipt.id)}</dd></div><div><dt>回滚引用</dt><dd>${escapeHtml(receipt.rollbackRef || '—')}</dd></div><div><dt>目标</dt><dd>${escapeHtml(receipt.targetUrl || urlName(item.targetUrlIds[0]))}</dd></div></dl>` : `<p class="v13-quality-note">发布后会在这里建立固定观察窗口、发布版本与回滚回执。</p>`}${observation ? `<button class="v13-quality-link" data-action="open-result-page" data-id="${observation.id}"><span>最新观察</span><strong>${statusLabel('observationStatus', observation.status)} · 转化 ${escapeHtml(metricPairText(observation.metrics?.conversions))}</strong>${icon('arrow')}</button>` : ''}</section></aside></div>`;
  }

  function artifactDocument(item) {
    if (item.generatedContent) {
      const content = item.generatedContent;
      return `<div class="client-generated-artifact"><section><span>执行目标</span><h3>${escapeHtml(content.objective)}</h3><p>${escapeHtml(content.summary)}</p></section><section><h3>主要 Finding</h3><p>${escapeHtml(content.primaryFinding)}</p></section><section><h3>证据与适用范围</h3><ul>${content.evidence.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul></section><section><h3>执行方案</h3><ol>${content.steps.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol></section><section><h3>验收条件</h3><ul>${content.acceptance.map((entry) => `<li>${escapeHtml(entry)}</li>`).join('')}</ul></section><section><h3>限制与回滚</h3><p>${escapeHtml(content.limitation)}</p><p>${escapeHtml(content.rollback)}</p></section></div>`;
    }
    const document = workspace.artifactDocuments.find((candidate) => candidate.id === item.documentId)
      || workspace.artifactDocuments.find((candidate) => candidate.artifactId === item.id && Number(candidate.revision) === Number(item.revision));
    if (!document) {
      return `<div class="client-brief"><h3>${escapeHtml(artifactTypeLabels[item.type] || item.type)}</h3><p>这份交付物尚未绑定客户可见 Document。关联机会、目标 URL、证据与门禁仍然保留，但当前不会用另一份场景正文静默补位。</p></div>`;
    }
    const isEnglishBlog = item.type === 'english_blog_draft' && /^en/i.test(document.language || '');
    const renderBlock = (block) => `<section data-document-block="${escapeHtml(block.id)}">${block.heading && (!isEnglishBlog || block.heading !== document.title) ? `<h${isEnglishBlog ? '2' : '3'}>${escapeHtml(block.heading)}</h${isEnglishBlog ? '2' : '3'}>` : ''}${(block.paragraphs || []).map((paragraph) => `<p>${escapeHtml(paragraph)}</p>`).join('')}${block.keyValues?.length ? `<dl class="client-brief-grid">${block.keyValues.map((entry) => `<div><dt>${escapeHtml(entry.label)}</dt><dd>${escapeHtml(entry.value)}</dd></div>`).join('')}</dl>` : ''}${block.bullets?.length ? `<ul>${block.bullets.map((bullet) => `<li>${escapeHtml(bullet)}</li>`).join('')}</ul>` : ''}${block.code ? `<pre><code data-language="${escapeHtml(block.code.language || 'text')}">${escapeHtml(block.code.content)}</code></pre>` : ''}</section>`;
    const qa = document.qa || { label: 'QA / 质量检查', status: 'pending', checks: [] };
    const review = document.revisionReview || {};
    const releaseAndResults = document.releaseAndResults || {};
    return `<article class="${isEnglishBlog ? 'client-blog-draft' : 'client-brief'} client-canonical-document" lang="${escapeHtml(document.language || 'zh-CN')}" data-document-id="${escapeHtml(document.id)}"><p class="client-doc-label">${escapeHtml(document.scenarioLabel || seed.scenarioLabel || '离线演示场景')} · ${escapeHtml(document.documentTypeLabel || artifactTypeLabels[item.type] || item.type)}</p>${isEnglishBlog ? `<h1>${escapeHtml(document.title)}</h1>` : `<h3>${escapeHtml(document.title)}</h3>`}<p class="client-lede">${escapeHtml(document.summary)}</p>${(document.blocks || []).map(renderBlock).join('')}<section class="client-canonical-governance"><h3>${escapeHtml(qa.label)}</h3><p><strong>${qa.status === 'passed' ? '已通过' : '仍有待处理项'}</strong></p><ul>${(qa.checks || []).map((check) => `<li><strong>${escapeHtml(check.label)} · ${check.status === 'passed' ? '已通过' : '待处理'}</strong><span>${escapeHtml(check.evidence)}</span></li>`).join('')}</ul></section><section class="client-canonical-governance"><h3>${escapeHtml(review.label || 'Revision Review / 版本审核')}</h3><dl class="client-brief-grid"><div><dt>Revision</dt><dd>${escapeHtml(review.revision ?? document.revision)}</dd></div><div><dt>审核决定</dt><dd>${escapeHtml(review.decision || '待审核')}</dd></div><div><dt>审核人</dt><dd>${escapeHtml(review.reviewedBy || '尚未完成人工审核')}</dd></div><div><dt>审核时间</dt><dd>${escapeHtml(review.reviewedAt ? dateZh(review.reviewedAt) : '尚未完成')}</dd></div></dl><p>${escapeHtml(review.note || '当前 Revision 尚无额外审核说明。')}</p></section><section class="client-canonical-governance"><h3>${escapeHtml(releaseAndResults.label || 'Publish / Change Receipt 与 Results / 效果结果')}</h3><p>${escapeHtml(releaseAndResults.receiptStatement || '当前 Revision 没有关联发布或变更回执。')}</p><p><strong>归因边界：</strong>${escapeHtml(releaseAndResults.attributionBoundary || seed.attributionBoundary || '动作回执不等于效果，固定窗口观察不归因给单一交付物。')}</p><dl class="client-brief-grid"><div><dt>Release IDs</dt><dd>${escapeHtml((releaseAndResults.releaseIds || []).join(' · ') || '无')}</dd></div><div><dt>Observation IDs</dt><dd>${escapeHtml((releaseAndResults.observationIds || []).join(' · ') || '无')}</dd></div><div><dt>Campaign IDs</dt><dd>${escapeHtml((releaseAndResults.campaignIds || []).join(' · ') || '无')}</dd></div></dl></section></article>`;
  }

  function renderResults() {
    const totals = derived().resultTotals;
    const tagged = derived().taggedTotals;
    const window = activeResultWindow();
    const actions = '<button class="button button--primary" data-action="share-report">模拟分享结果</button>';
    const tabs = [['overview', '结果摘要'], ['pages', '页面改前 / 改后'], ['campaigns', 'Campaign / UTM']];
    return `${pageHeader('效果追踪', '改前、改后与归因边界', `${window.baseline.start}–${window.baseline.end} 对比 ${window.current.start}–${window.current.end} · ${escapeHtml(window.current.market || window.baseline.market || '美国市场')} · 固定 ${window.current.days || window.baseline.days || 28} 天`, actions)}
      <section class="client-kpi-strip client-result-strip">
        <div><span>自然搜索点击</span><strong>${compact(totals.clicks.current)}</strong><small>${compact(totals.clicks.before)} → ${compact(totals.clicks.current)} · ${percent(totals.clicks.before, totals.clicks.current)}</small></div>
        <div><span>转化</span><strong>${compact(totals.conversions.current)}</strong><small>${compact(totals.conversions.before)} → ${compact(totals.conversions.current)} · ${percent(totals.conversions.before, totals.conversions.current)}</small></div>
        <div><span>AI 引用</span><strong>${compact(totals.aiCitations.current)}</strong><small>${compact(totals.aiCitations.before)} → ${compact(totals.aiCitations.current)} · ${percent(totals.aiCitations.before, totals.aiCitations.current)}</small></div>
        <div><span>UTM 转化</span><strong>${compact(tagged.conversions.current)}</strong><small>${compact(tagged.conversions.before)} → ${compact(tagged.conversions.current)} · ${percent(tagged.conversions.before, tagged.conversions.current)}</small></div>
      </section>
      <section class="panel client-results-panel">
        <div class="client-segmented client-results-tabs" role="tablist" aria-label="效果追踪视图">${tabs.map(([key, label]) => `<button id="tab-results-${key}" role="tab" aria-controls="panel-results-${key}" aria-selected="${state.resultTab === key}" tabindex="${state.resultTab === key ? '0' : '-1'}" class="${state.resultTab === key ? 'is-active' : ''}" data-action="result-tab" data-tab="${key}">${label}</button>`).join('')}</div>
        <div id="panel-results-${state.resultTab}" role="tabpanel" aria-labelledby="tab-results-${state.resultTab}">${state.resultTab === 'overview' ? renderResultOverview() : state.resultTab === 'pages' ? renderResultPages() : renderResultCampaigns()}</div>
      </section>`;
  }

  function renderResultOverview() {
    const resultEvents = workspace.auditEvents.filter((event) => ['change_published', 'recheck_completed', 'observation_recorded'].includes(event.type)).slice(0, 5);
    return `<div class="client-result-overview"><section><div class="panel-heading"><div><span class="eyebrow">技术复查</span><h2>技术条件复查</h2></div></div><div class="client-verification-list client-verification-list--expanded">${workspace.results.technicalVerifications.map((item) => { const opportunity = byId(workspace.opportunities, item.opportunityId); const freshness = sourceFreshness(item.sourceRefs); return `<button data-action="open-opportunity" data-id="${item.opportunityId}"><header><span>${badge(statusLabel('verificationStatus', item.status), toneFor(item.status))}</span><strong>${escapeHtml(opportunity?.title || item.assertion)}</strong>${icon('arrow')}</header><div class="client-recheck-values"><span><small>旧值</small><strong>${item.beforeValue ?? '不可用'}</strong></span><span><small>新值</small><strong>${item.currentValue ?? '不可用'}</strong></span><span><small>验收值</small><strong>${item.expectedValue ?? '未定义'}</strong></span></div><small>${escapeHtml(item.metric || item.assertion)} · ${item.checkedUrlIds.map(urlName).join(', ')} · ${dateZh(item.checkedAt)}</small><em>来源：${item.sourceRefs.map(sourceName).join(' · ')} · 更新于 ${escapeHtml(freshness.label)}${item.limitation ? ` · ${escapeHtml(item.limitation)}` : ''}</em></button>`; }).join('')}</div></section><section><div class="panel-heading"><div><span class="eyebrow">结论边界</span><h2>这组结果能说明什么</h2></div></div><div class="client-boundary"><p><strong>已验证</strong> 只用于可复查的技术条件，例如 canonical 是否唯一。</p><p><strong>已观察</strong> 表示固定窗口内的相关指标变化，不归因给单一 Artifact。</p><p><strong>数据不足</strong> 表示样本或 Campaign 组合不足以支持结论，例如当前 Pricing Landing。</p><p><strong>回执不等于效果</strong>：发布回执只证明动作发生；效果结论仍需独立的技术复查或固定窗口观察。</p></div></section></div><section class="client-change-timeline"><div class="panel-heading"><div><span class="eyebrow">变更与发布回执</span><h2>动作回执与结果时间线</h2></div><span>共 ${workspace.releases.length + resultEvents.length} 条记录</span></div><div class="client-change-timeline__grid"><div><h3>动作回执 · 证明动作发生</h3>${workspace.releases.map((release) => { const artifact = byId(workspace.artifacts, release.artifactId); return `<button data-action="open-receipt" data-id="${release.artifactId}"><span>${badge('回执', 'neutral')}</span><strong>${escapeHtml(artifact?.title || release.id)}</strong><small>${escapeHtml(release.id)} · ${dateZh(release.publishedAt)}</small>${icon('arrow')}</button>`; }).join('')}</div><div><h3>效果结果 · 独立观察或复查</h3>${resultEvents.map((event) => `<button data-action="open-audit-event" data-id="${event.id}"><span>${badge(event.type === 'recheck_completed' ? '复查' : '观察', event.type === 'recheck_completed' ? 'success' : 'neutral')}</span><strong>${escapeHtml(eventLabels[event.type] || event.type)}</strong><small>${dateZh(event.at)} · ${event.objectRefs.length} 个对象</small>${icon('arrow')}</button>`).join('')}</div></div></section>`;
  }

  function renderResultPages() {
    const results = activeResultsRecord();
    return `<div class="client-table-scroll"><table class="client-table client-result-page-table"><thead><tr><th>页面</th><th>状态</th><th>自然搜索点击</th><th>转化</th><th>AI 引用</th><th></th></tr></thead><tbody>${(results.pageObservations || []).map((item) => { const url = byId(workspace.urls, item.urlId); const freshness = sourceFreshness(item.sourceRefs); return `<tr><td><button class="client-primary-cell" data-action="open-result-page" data-id="${item.id}"><strong>${escapeHtml(url?.title)}</strong><small>${escapeHtml(url?.path)} · 来源 ${item.sourceRefs.map(sourceName).join(' / ') || '尚无可用观测来源'} · 更新 ${escapeHtml(freshness.label)}</small></button></td><td>${badge(statusLabel('observationStatus', item.status), toneFor(item.status))}</td><td>${escapeHtml(metricPairText(item.metrics?.clicks))}</td><td>${escapeHtml(metricPairText(item.metrics?.conversions))}</td><td>${escapeHtml(metricPairText(item.metrics?.aiCitations))}</td><td><button class="row-arrow" data-action="open-result-page" data-id="${item.id}" aria-label="查看页面结果">${icon('arrow')}</button></td></tr>`; }).join('')}</tbody></table></div>`;
  }

  function renderResultCampaigns() {
    const tagged = derived().taggedTotals;
    return `<div class="client-campaign-summary"><div><span>UTM 会话</span><strong>${compact(tagged.sessions.before)} → ${compact(tagged.sessions.current)}</strong></div><div><span>直接转化</span><strong>${compact(tagged.conversions.before)} → ${compact(tagged.conversions.current)}</strong></div><div><span>辅助转化</span><strong>${compact(tagged.assistedConversions.before)} → ${compact(tagged.assistedConversions.current)}</strong></div></div><div class="client-table-scroll"><table class="client-table client-campaign-table"><thead><tr><th>Campaign / 来源</th><th>媒介</th><th>内容标记</th><th>会话</th><th>转化</th><th>辅助转化</th><th></th></tr></thead><tbody>${workspace.campaigns.map((item) => { const freshness = sourceFreshness(item.sourceRefs); return `<tr><td><button class="client-primary-cell" data-action="open-campaign" data-id="${item.id}"><strong>${escapeHtml(item.campaign || item.source)}</strong><small>${escapeHtml(item.source)} · 来源 ${item.sourceRefs.map(sourceName).join(' / ')} · 更新 ${escapeHtml(freshness.label)}</small></button></td><td>${escapeHtml(item.medium)}</td><td><code>${escapeHtml(item.content)}</code></td><td>${item.metrics.sessions.before} → <strong>${item.metrics.sessions.current}</strong></td><td>${item.metrics.conversions.before} → <strong>${item.metrics.conversions.current}</strong></td><td>${item.metrics.assistedConversions.before} → <strong>${item.metrics.assistedConversions.current}</strong></td><td><button class="row-arrow" data-action="open-campaign" data-id="${item.id}" aria-label="查看 Campaign 详情">${icon('arrow')}</button></td></tr>`; }).join('')}</tbody></table></div>`;
  }

  function overlayFrame(title, subtitle, body, options = {}) {
    const kind = options.drawer ? 'client-drawer' : 'client-modal';
    return `<div class="client-overlay" data-overlay="${escapeHtml(state.overlay)}"><button class="client-overlay__scrim" data-action="close-overlay" aria-label="关闭"></button><section class="${kind} ${options.wide ? 'is-wide' : ''}" role="dialog" aria-modal="true" aria-labelledby="overlay-title"><header class="client-overlay__header"><div><span class="eyebrow">${escapeHtml(subtitle || '')}</span><h2 id="overlay-title">${escapeHtml(title)}</h2></div><button class="icon-button" data-action="close-overlay" aria-label="关闭">${icon('close')}</button></header><div class="client-overlay__body">${body}</div>${options.footer ? `<footer class="client-overlay__footer">${options.footer}</footer>` : ''}</section></div>`;
  }

  function renderOverlay() {
    if (!state.overlay) return '';
    const id = state.overlayPayload?.id || state.overlayPayload;
    switch (state.overlay) {
      case 'profile': return renderProfileOverlay();
      case 'profile-edit': return renderProfileEdit();
      case 'profile-evidence': return renderProfileEvidence();
      case 'profile-history': return renderProfileHistory();
      case 'profile-version': return renderProfileVersion(id);
      case 'connections': return renderConnections();
      case 'source-detail': return renderSourceDetail(id);
      case 'sync-run': return renderSyncRun();
      case 'page-filters': return renderPageFilters();
      case 'page-evidence': return renderPageEvidence(id);
      case 'keyword-detail': return renderKeywordDetail(id);
      case 'keyword-add': return renderKeywordAdd();
      case 'competitor-detail': return renderCompetitorDetail(id);
      case 'competitor-add': return renderCompetitorAdd();
      case 'competitor-review': return renderCompetitorReview(id);
      case 'finding-review': return renderFindingReview(id);
      case 'opportunity': return renderOpportunity(id);
      case 'opportunity-decision': return renderOpportunityDecision(id);
      case 'task-preview': return renderTaskPreview(state.overlayPayload);
      case 'artifact-share': return renderArtifactShare(id);
      case 'artifact-edit': return renderArtifactEdit(id);
      case 'artifact-create': return renderArtifactCreate(id);
      case 'artifact-history': return renderArtifactHistory(id);
      case 'artifact-revision': return renderArtifactRevision(id);
      case 'artifact-approve': return renderArtifactApprove(id);
      case 'artifact-publish': return renderArtifactPublish(id);
      case 'receipt': return renderReceipt(state.overlayPayload);
      case 'result-page': return renderResultPage(id);
      case 'campaign': return renderCampaign(id);
      case 'report-share': return renderReportShare();
      case 'audit-event': return renderAuditEvent(id);
      default: return '';
    }
  }

  function renderProfileOverlay() {
    const profile = workspace.profile;
    const approved = workspace.competitors.filter((item) => item.status === 'approved');
    const triggers = profile.primaryIcp.buyingTriggers || profile.buyingTriggers || [];
    const pains = profile.primaryIcp.pains || profile.pains || [];
    const useCases = profile.primaryIcp.useCases || profile.useCases || [];
    return overlayFrame('产品与客户画像', `已确认画像 · v${profile.version}`, `
      <div class="client-profile-hero"><span class="client-profile-logo">RO</span><div><h3>${escapeHtml(workspace.project.name)}</h3><p>${escapeHtml(profile.oneLiner)}</p><button class="client-profile-site" data-action="open-page" data-id="url-home">${escapeHtml(workspace.project.website)} ${icon('arrow')}</button></div>${badge('客户已确认', 'success')}</div>
      <section class="client-overlay-section"><h3>产品与商业模式</h3><p>${escapeHtml(profile.valueProposition)}</p><dl class="client-detail-grid"><div><dt>产品类别</dt><dd>${escapeHtml(profile.productCategoryLabel || profile.productCategory || '待确认')}</dd></div><div><dt>商业模式</dt><dd>${escapeHtml(profile.businessModel?.label || profile.businessModel || '待确认')}</dd></div><div><dt>核心 Offer</dt><dd>${escapeHtml(profile.offer?.coreProduct ? `${profile.offer.coreProduct} · ${profile.offer.package}` : profile.offer || profile.valueProposition)}</dd></div><div><dt>主要市场</dt><dd>${escapeHtml(profile.primaryMarket?.geography ? `${profile.primaryMarket.geography} · ${profile.primaryMarket.language}` : profile.primaryMarket || workspace.project.primaryMarket)}</dd></div></dl></section>
      <section class="client-overlay-section"><h3>主要 ICP</h3><dl class="client-detail-grid"><div><dt>目标公司</dt><dd>${escapeHtml(profile.primaryIcp.company)}</dd></div><div><dt>决策者</dt><dd>${escapeHtml(profile.primaryIcp.buyer)}</dd></div><div><dt>内部推动者</dt><dd>${escapeHtml(profile.primaryIcp.champion)}</dd></div><div><dt>核心用户</dt><dd>${profile.primaryIcp.users.map(escapeHtml).join(' · ')}</dd></div></dl><h4>待完成任务（JTBD）</h4><ul>${profile.primaryIcp.jobsToBeDone.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>
      <section class="client-overlay-section"><h3>购买触发、痛点与使用场景</h3><dl class="client-profile-model-grid"><div><dt>购买触发</dt><dd>${triggers.map((item) => `<span>${escapeHtml(item)}</span>`).join('') || '<span>待补充</span>'}</dd></div><div><dt>核心痛点</dt><dd>${pains.map((item) => `<span>${escapeHtml(item)}</span>`).join('') || '<span>待补充</span>'}</dd></div><div><dt>主要使用场景</dt><dd>${useCases.map((item) => `<span>${escapeHtml(item)}</span>`).join('') || '<span>待补充</span>'}</dd></div></dl></section>
      <section class="client-overlay-section"><div class="client-section-heading"><h3>已确认竞品池</h3><button class="text-button" data-action="go-competitors">在增长地图查看 ${icon('arrow')}</button></div><div class="client-compact-list">${approved.map((item) => `<button data-action="open-competitor" data-id="${item.id}"><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(relationLabels[item.relation])} · ${item.organicOverlapPct}% 自然搜索重合度</small>${icon('arrow')}</button>`).join('')}</div></section>
    `, { drawer: true, footer: '<button class="button button--secondary" data-action="open-profile-history">版本历史</button><button class="button button--secondary" data-action="open-profile-evidence">字段证据</button><button class="button button--primary" data-action="edit-profile">编辑画像</button>' });
  }

  function renderProfileEdit() {
    const profile = workspace.profile;
    const triggers = profile.primaryIcp.buyingTriggers || profile.buyingTriggers || [];
    const pains = profile.primaryIcp.pains || profile.pains || [];
    const useCases = profile.primaryIcp.useCases || profile.useCases || [];
    const businessType = profile.businessModel?.type || profile.businessModel;
    const marketCode = profile.primaryMarket?.countryCode || profile.primaryMarket || workspace.project.primaryMarket;
    const offerValue = profile.offer?.coreProduct || profile.offer || profile.valueProposition;
    return overlayFrame('编辑产品与 ICP', '只保留会影响诊断、关键词与内容的字段', `<form id="profile-edit-form" data-form="profile-edit" class="client-form">
      <label><span>一句话产品定位</span><textarea name="oneLiner" required>${escapeHtml(profile.oneLiner)}</textarea></label>
      <label><span>核心价值主张</span><textarea name="valueProposition" required>${escapeHtml(profile.valueProposition)}</textarea></label>
      <div class="client-form-grid"><label><span>商业模式</span><select name="businessModel"><option value="b2b_saas_subscription" ${businessType === 'b2b_saas_subscription' ? 'selected' : ''}>企业软件订阅制</option><option value="transaction" ${businessType === 'transaction' ? 'selected' : ''}>交易抽成</option><option value="freemium" ${businessType === 'freemium' ? 'selected' : ''}>Freemium</option><option value="hybrid" ${businessType === 'hybrid' ? 'selected' : ''}>混合模式</option></select></label><label><span>主要市场</span><select name="primaryMarket"><option value="US" ${marketCode === 'US' ? 'selected' : ''}>美国</option><option value="UK" ${marketCode === 'UK' ? 'selected' : ''}>英国</option><option value="AU" ${marketCode === 'AU' ? 'selected' : ''}>澳大利亚</option><option value="Global" ${marketCode === 'Global' ? 'selected' : ''}>全球英语市场</option></select></label></div>
      <label><span>核心 Offer</span><input name="offer" value="${escapeHtml(offerValue)}" required></label>
      <div class="client-form-grid"><label><span>目标公司</span><input name="company" value="${escapeHtml(profile.primaryIcp.company)}" required></label><label><span>决策者</span><input name="buyer" value="${escapeHtml(profile.primaryIcp.buyer)}" required></label><label><span>内部推动者</span><input name="champion" value="${escapeHtml(profile.primaryIcp.champion)}" required></label><label><span>核心用户（逗号分隔）</span><input name="users" value="${escapeHtml(profile.primaryIcp.users.join(', '))}" required></label></div>
      <label><span>待完成任务 JTBD（每行一项）</span><textarea name="jobs" rows="3">${escapeHtml(profile.primaryIcp.jobsToBeDone.join('\n'))}</textarea></label>
      <label><span>购买触发（每行一项）</span><textarea name="triggers" rows="3">${escapeHtml(triggers.join('\n'))}</textarea></label>
      <label><span>核心痛点（每行一项）</span><textarea name="pains" rows="3">${escapeHtml(pains.join('\n'))}</textarea></label>
      <label><span>主要使用场景（每行一项）</span><textarea name="useCases" rows="3">${escapeHtml(useCases.join('\n'))}</textarea></label>
    </form>`, { wide: true, footer: '<button class="button button--secondary" data-action="close-overlay">取消</button><button class="button button--primary" type="submit" form="profile-edit-form">保存为新版本</button>' });
  }

  function renderProfileEvidence() {
    const fields = profileFieldRecords();
    return overlayFrame('字段证据', '每个画像结论都有推导方式、来源、置信度与状态', `<div class="client-evidence-list">${fields.map((field) => {
      const sources = (field.evidenceRefs || []).map(sourceName);
      const stateLabel = field.status === 'confirmed' ? '已确认' : field.status === 'conflicting' ? '信息冲突' : field.status === 'missing' ? '待补充' : 'AI 建议';
      return `<article><span>${badge(stateLabel, field.status === 'confirmed' ? 'success' : 'warning')}</span><div><h3>${escapeHtml(field.label || field.key)}</h3><strong>${escapeHtml(displayProfileValue(field.value))}</strong><p>${escapeHtml(field.derivation || '由客户确认与已批准证据共同生成。')}</p><small>来源：${escapeHtml(sources.join(' · ') || '客户确认')} · 置信度 ${escapeHtml(profileConfidenceLabel(field.confidence))}</small></div></article>`;
    }).join('') || '<div class="empty-state">当前版本尚未生成字段级证据。</div>'}</div><div class="client-honesty-note">缺失与冲突字段会明确保留，不会被自动补成确定结论；修改画像会创建新的不可变版本。</div>`, { drawer: true, footer: '<button class="button button--secondary" data-action="open-profile-history">查看版本历史</button><button class="button button--primary" data-action="open-profile">返回画像</button>' });
  }

  function renderProfileHistory() {
    const versions = [...workspace.profileVersions].sort((a, b) => Number(b.version) - Number(a.version));
    return overlayFrame('产品画像版本历史', 'Append-only · 历史版本不可覆盖', `<div class="client-version-list">${versions.map((version) => {
      const snapshot = version.snapshot || version.profile || version;
      const isCurrent = Number(version.version) === Number(workspace.profile.version);
      return `<button data-action="open-profile-version" data-id="${escapeHtml(version.id || `${workspace.profile.id}-v${version.version}`)}"><span>${badge(isCurrent ? '当前版本' : '历史版本', isCurrent ? 'success' : 'neutral')}</span><strong>产品画像 v${version.version}</strong><small>${dateZh(version.confirmedAt || snapshot.confirmedAt)} · ${escapeHtml(version.confirmedBy || snapshot.confirmedBy || '客户确认')}</small>${icon('arrow')}</button>`;
    }).join('')}</div><div class="client-honesty-note">新版本只会追加；Growth Opportunity 与交付物可继续引用当时使用的画像版本。</div>`, { drawer: true, footer: '<button class="button button--primary" data-action="open-profile">返回当前画像</button>' });
  }

  function renderProfileVersion(id) {
    const version = workspace.profileVersions.find((item) => item.id === id) || workspace.profileVersions.find((item) => String(item.version) === String(id).replace(/^.*-v/, ''));
    if (!version) return overlayFrame('未找到画像版本', '版本历史', '<div class="empty-state">该历史版本不存在或不在当前项目中。</div>', { drawer: true });
    const snapshot = version.snapshot || version.profile || version;
    const fields = profileFieldRecords(snapshot);
    return overlayFrame(`产品画像 v${version.version}`, Number(version.version) === Number(workspace.profile.version) ? '当前生效版本' : '只读历史版本', `<dl class="client-detail-grid"><div><dt>一句话定位</dt><dd>${escapeHtml(snapshot.oneLiner || '—')}</dd></div><div><dt>商业模式</dt><dd>${escapeHtml(snapshot.businessModel?.label || snapshot.businessModel || '—')}</dd></div><div><dt>核心 Offer</dt><dd>${escapeHtml(snapshot.offer?.coreProduct || snapshot.offer || snapshot.valueProposition || '—')}</dd></div><div><dt>主要市场</dt><dd>${escapeHtml(snapshot.primaryMarket?.geography || snapshot.primaryMarket || workspace.project.primaryMarket)}</dd></div><div><dt>目标公司</dt><dd>${escapeHtml(snapshot.primaryIcp?.company || '—')}</dd></div><div><dt>决策者</dt><dd>${escapeHtml(snapshot.primaryIcp?.buyer || '—')}</dd></div></dl><section class="client-overlay-section"><h3>字段快照</h3><div class="client-version-fields">${fields.map((field) => `<div><span>${escapeHtml(field.label || field.key)}</span><strong>${escapeHtml(displayProfileValue(field.value))}</strong><small>${field.status === 'confirmed' ? '已确认' : field.status === 'conflicting' ? '信息冲突' : field.status === 'missing' ? '待补充' : 'AI 建议'} · 置信度 ${escapeHtml(profileConfidenceLabel(field.confidence))}</small></div>`).join('')}</div></section>`, { wide: true, footer: '<button class="button button--primary" data-action="open-profile-history">返回版本历史</button>' });
  }

  function renderConnections() {
    const freshness = new Map(seed.selectors.sourceFreshness({ ...workspace, snapshotAt: seed.snapshotAt }).map((item) => [item.sourceId, item]));
    const sources = customerConnections();
    const analysisSources = sources.filter((source) => ['search_console', 'analytics'].includes(source.kind));
    const plannedSources = sources.filter((source) => source.status === 'planned');
    return overlayFrame('数据连接', '客户可管理的分析与交付连接', `<div class="client-source-summary"><div><strong>${sources.length}</strong><span>客户可见连接</span></div><div><strong>${analysisSources.length}</strong><span>当前用于分析</span></div><div><strong>${plannedSources.length}</strong><span>预留工作流</span></div></div><div class="client-source-list">${sources.map((source) => { const fresh = freshness.get(source.id); const short = source.kind === 'search_console' ? 'GSC' : source.kind === 'analytics' ? 'GA4' : 'GH'; return `<button data-action="open-source" data-id="${source.id}"><span class="client-source-icon">${short}</span><span><strong>${escapeHtml(source.name)}</strong><small>${escapeHtml(source.recordScope)}</small></span><span class="client-source-state">${badge(source.status === 'planned' ? '待接入' : fresh?.freshness === 'fresh' ? '可用于分析' : '需更新', source.status === 'planned' ? 'warning' : fresh?.freshness === 'fresh' ? 'success' : 'warning')}<small>${source.observedAt ? dateZh(source.observedAt) : '后续开放'}</small></span>${icon('arrow')}</button>`; }).join('')}</div><div class="client-honesty-note"><strong>连接状态口径：</strong>已连接、采集中、数据可用、尚未接入、连接失败。当前场景中 GSC 与 GA4 数据可用，GitHub 尚未接入；抓取、研究与内容证据由系统自动维护。</div>`, { drawer: true, footer: '<button class="button button--primary" data-action="start-sync">更新 GSC / GA4 数据</button>' });
  }

  function renderSourceDetail(id) {
    const source = byId(workspace.dataSources, id);
    if (!source) return '';
    if (source.audienceVisibility !== 'customer') {
      return overlayFrame('系统证据', '由工作台自动维护', `<section class="client-overlay-section"><h3>${escapeHtml(source.name)}</h3><p>这条证据用于说明某个 URL、关键词或竞品为什么进入当前分析链路，并持续参与机会判断与质量核验。</p></section><div class="client-honesty-note">该证据不需要你额外连接或维护。</div>`, { drawer: true, footer: '<button class="button button--primary" data-action="close-overlay">完成</button>' });
    }
    if (source.kind === 'github') {
      return overlayFrame('GitHub 自动修复', '预留连接 · 尚未开放', `<div class="client-profile-hero"><span class="client-profile-logo">GH</span><div><h3>从代码修复到 PR</h3><p>GitHub 位置已经进入客户工作台，但当前场景不会访问仓库或创建真实 PR。</p></div>${badge('待接入', 'warning')}</div><section class="client-overlay-section"><h3>计划中的客户流程</h3><ol class="v13-planned-flow">${source.plannedFlow.map((step, index) => `<li><span>${String(index + 1).padStart(2, '0')}</span><strong>${escapeHtml(step)}</strong></li>`).join('')}</ol></section><div class="client-honesty-note">只有已批准且通过技术与人工质量门槛的代码修复才能进入该流程；合并仍需要客户或工程团队确认。</div>`, { drawer: true, footer: '<button class="button button--secondary" data-action="open-connections">返回数据连接</button><button class="button button--primary" disabled>等待 GitHub 接入</button>' });
    }
    const usage = source.kind === 'search_console' ? '用于增长地图中的查询、落地页、排名与搜索观察。' : '用于结果中的页面、营销活动 / UTM 与转化观察。';
    return overlayFrame(source.name, source.kind === 'search_console' ? '搜索表现' : '分析与转化', `<dl class="client-detail-grid"><div><dt>分析范围</dt><dd>${escapeHtml(source.recordScope)}</dd></div><div><dt>最后观察</dt><dd>${dateZh(source.observedAt)}</dd></div><div><dt>数据新鲜度 SLA</dt><dd>${source.freshnessSlaHours} 小时</dd></div><div><dt>当前模式</dt><dd>${source.externalConnection ? '真实数据提供商 · 只读' : '确定性场景快照'}</dd></div></dl><section class="client-overlay-section"><h3>在工作台中的用途</h3><p>${escapeHtml(usage)}</p></section><section class="client-overlay-section"><h3>当前已支撑</h3><p>${workspace.urls.filter((item) => item.sourceRefs.includes(source.id)).length} 个 URL · ${workspace.keywords.filter((item) => item.sourceRefs.includes(source.id)).length} 个关键词 · ${workspace.results.pageObservations.filter((item) => item.sourceRefs.includes(source.id)).length} 条结果观察</p></section>`, { drawer: true, footer: '<button class="button button--secondary" data-action="open-connections">返回数据连接</button><button class="button button--primary" data-action="start-sync">运行更新</button>' });
  }

  function renderSyncRun() {
    const runId = `RUN-20260721-${String(workspace.auditEvents.filter((e) => e.type === 'sync_completed').length + 1).padStart(2, '0')}`;
    return overlayFrame('更新分析数据', 'GSC / GA4 · 可审核运行', `<form id="sync-run-form" data-form="sync-run" class="client-form" data-sync-run-id="${runId}"><div class="client-run-id"><span>运行 ID</span><strong>${runId}</strong></div><div class="client-run-steps"><label><input type="checkbox" name="sources" value="src-gsc" checked> Google Search Console（GSC）<span>${workspace.keywords.length} 个关键词 · ${workspace.results.pageObservations.length} 条页面观察</span></label><label><input type="checkbox" name="sources" value="src-ga4" checked> Google Analytics 4（GA4）<span>${workspace.campaigns.length} 条营销活动数据 · 转化观察</span></label></div><div class="client-run-preview"><div><span>可选连接</span><strong>2 个数据源</strong></div><div><span>审计策略</span><strong>保留运行记录</strong></div><div><span>外部写入</span><strong>不会发生</strong></div></div></form>`, { footer: '<button class="button button--secondary" data-action="close-overlay">取消</button><button class="button button--primary" type="submit" form="sync-run-form">运行并生成回执</button>' });
  }

  function renderPageFilters() {
    const templates = [...new Set(workspace.urls.map((item) => item.templateKey).filter(Boolean))].sort();
    const statuses = [...new Set(workspace.urls.map((item) => item.status))].sort();
    return overlayFrame('筛选页面与机会', '模板、主题簇、状态与能力视角', `<form id="page-filter-form" data-form="page-filters" class="client-form"><div class="client-form-grid"><label><span>模板</span><select name="template"><option value="all">全部模板</option>${templates.map((value) => `<option value="${value}" ${state.pageTemplateFilter === value ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('')}</select></label><label><span>主题簇</span><select name="cluster"><option value="all">全部主题簇</option>${workspace.clusters.map((cluster) => `<option value="${cluster.id}" ${state.pageClusterFilter === cluster.id ? 'selected' : ''}>${escapeHtml(cluster.label)}</option>`).join('')}</select></label><label><span>页面状态</span><select name="status"><option value="all">全部状态</option>${statuses.map((value) => `<option value="${value}" ${state.pageStatusFilter === value ? 'selected' : ''}>${escapeHtml(statusLabel('urlStatus', value))}</option>`).join('')}</select></label><label><span>能力视角</span><select name="lens"><option value="all">全部视角</option>${Object.entries(labels.lens).map(([value, label]) => `<option value="${value}" ${state.pageLensFilter === value ? 'selected' : ''}>${escapeHtml(label)}</option>`).join('')}</select></label></div><div class="client-honesty-note">能力视角只用于筛选同一条增长机会链，不会创建另一套页面或状态。</div></form>`, { drawer: true, footer: '<button class="button button--secondary" data-action="clear-page-filters">清除高级筛选</button><button class="button button--primary" type="submit" form="page-filter-form">应用筛选</button>' });
  }

  function renderPageEvidence(id) {
    const url = byId(workspace.urls, id);
    if (!url) return '';
    const findings = workspace.findings.filter((item) => item.urlIds.includes(id));
    const opportunities = workspace.opportunities.filter((item) => item.urlIds.includes(id));
    const artifacts = workspace.artifacts.filter((item) => item.targetUrlIds.includes(id));
    const observation = workspace.results.pageObservations.find((item) => item.urlId === id);
    const severityLabels = { high: '高', medium: '中', low: '低' };
    const evidenceArtifactTypeLabels = { english_blog_draft: '英文博客', content_brief: '内容简报', code_patch: '代码修复', metadata_rewrite: '元数据重写', schema_patch: 'Schema 修复', landing_revision: '落地页改版', publish_receipt: '发布回执', comparison_brief: '竞品对比简报' };
    const tabs = [['summary', '摘要'], ['crawl', '抓取 / 渲染'], ['analytics', '搜索 / 分析'], ['history', '执行与复查']];
    let content = '';
    if (state.evidenceTab === 'summary') content = `<div class="client-evidence-hero"><div><span>页面类型</span><strong>${escapeHtml(url.pageType === 'blog' ? '博客页' : pageTypeLabels[url.pageType] || url.pageType)}</strong></div><div><span>优先级</span><strong>${url.priority.toUpperCase()}</strong></div><div><span>发现问题</span><strong>${findings.length}</strong></div><div><span>交付物</span><strong>${artifacts.length}</strong></div></div><section class="client-overlay-section"><h3>已发现问题</h3><div class="client-compact-list">${findings.map((item) => { const opportunity = opportunities.find((opp) => opp.findingIds.includes(item.id)); const needsReview = item.status === 'unreviewed'; return `<button data-action="${needsReview || !opportunity ? 'review-finding' : 'open-opportunity'}" data-id="${needsReview || !opportunity ? item.id : opportunity.id}"><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(labels.lens[item.lens])} · ${severityLabels[item.severity] || item.severity} · ${needsReview ? '待审核' : statusLabel('findingStatus', item.status)}</small>${needsReview ? '<em>审核问题</em>' : ''}${icon('arrow')}</button>`; }).join('') || '<p>当前没有发现问题。</p>'}</div></section>`;
    if (state.evidenceTab === 'crawl') content = `<dl class="client-detail-grid"><div><dt>页面清单</dt><dd>站点地图 + 导航 + 渲染抓取</dd></div><div><dt>Canonical</dt><dd>${findings.some((item) => item.ruleId.includes('canonical')) ? '检测到 Canonical 冲突' : '1 个绝对目标 URL'}</dd></div><div><dt>主题簇</dt><dd>${escapeHtml(byId(workspace.clusters, url.clusterId)?.label)}</dd></div><div><dt>来源快照</dt><dd>${url.sourceRefs.map(sourceName).join(' · ')}</dd></div></dl><pre class="client-evidence-code"><code>GET ${escapeHtml(url.path)}\nrender_status: 200\nindexability: allowed\nstructured_findings: ${findings.filter((item) => item.lens === 'webtech').length}\nsnapshot: ${escapeHtml(seed.snapshotAt)}</code></pre>`;
    if (state.evidenceTab === 'analytics') {
      const window = activeResultWindow();
      content = observation ? `<div class="client-result-numbers">${metricCompare('点击量', observation.metrics.clicks)}${metricCompare('转化数', observation.metrics.conversions)}${metricCompare('AI 引用', observation.metrics.aiCitations)}</div><p class="client-honesty-note">窗口：${window.baseline.start}–${window.baseline.end} 对比 ${window.current.start}–${window.current.end}。状态：${statusLabel('observationStatus', observation.status)}。${escapeHtml(observation.limitation || observation.attributionBoundary || '')}</p>` : '<div class="empty-state">这个 URL 目前没有符合比较条件的观察记录。</div>';
    }
    if (state.evidenceTab === 'history') content = `<div class="client-compact-list">${artifacts.map((item) => `<button data-action="go-artifact" data-id="${item.id}"><strong>${escapeHtml(item.title)}</strong><small>${evidenceArtifactTypeLabels[item.type] || artifactTypeLabels[item.type] || item.type} · ${statusLabel('artifactStatus', item.status)}</small>${icon('arrow')}</button>`).join('') || '<p>尚无交付物。</p>'}</div><section class="client-overlay-section"><h3>技术复查</h3>${workspace.results.technicalVerifications.filter((item) => item.checkedUrlIds.includes(id)).map((item) => `<p>${badge(statusLabel('verificationStatus', item.status), toneFor(item.status))} <code>${escapeHtml(item.assertion)}</code></p>`).join('') || '<p>尚未进入复查窗口。</p>'}</section>`;
    return overlayFrame(url.title, url.path, `<div class="client-evidence-tabs" role="tablist" aria-label="页面证据视图">${tabs.map(([key, label]) => `<button id="tab-evidence-${key}" role="tab" aria-controls="panel-evidence-${key}" aria-selected="${state.evidenceTab === key}" tabindex="${state.evidenceTab === key ? '0' : '-1'}" class="${state.evidenceTab === key ? 'is-active' : ''}" data-action="evidence-tab" data-tab="${key}">${label}</button>`).join('')}</div><div id="panel-evidence-${state.evidenceTab}" role="tabpanel" aria-labelledby="tab-evidence-${state.evidenceTab}">${content}</div>`, { drawer: true });
  }

  function renderKeywordDetail(id) {
    const keyword = byId(workspace.keywords, id);
    if (!keyword) return '';
    const cluster = byId(workspace.clusters, keyword.clusterId);
    const mapped = byId(workspace.urls, keyword.mappedUrlId);
    const related = workspace.keywords.filter((item) => item.clusterId === keyword.clusterId && item.id !== keyword.id);
    const visibleSources = keyword.sourceRefs.map((sourceId) => byId(workspace.dataSources, sourceId)).filter((source) => source?.audienceVisibility === 'customer');
    const sourceRoute = keywordSourceMeta[keyword.sourceKind] || keywordSourceMeta.manual;
    const sourceLabels = { competitor_gap: '竞品关键词缺口', content_gap: '内容缺口', suggest_paa: '种子词 + 搜索建议 / PAA', community_voc: '社区 / VOC', trend_signal: '趋势信号', gsc_unexpected: 'GSC 意外词', manual_csv: '手动 / CSV', manual: '手动添加' };
    const intentLabels = { commercial: '商业意图', informational: '信息意图', comparison: '对比意图', implementation: '实施意图' };
    const mappedPage = mapped
      ? `<button class="inline-object" data-action="open-page" data-id="${mapped.id}">${escapeHtml(mapped.path)}</button>`
      : '<span class="inline-object is-static">新内容 / 尚未映射</span>';
    const freshness = sourceFreshness(keyword.sourceRefs);
    return overlayFrame(keyword.text, `${keyword.market} · ${intentLabels[keyword.intent] || keyword.intent}`, `<div class="client-keyword-metrics"><div><span>搜索量</span><strong>${metricValue(keyword.volume, '未连接')}</strong></div><div><span>KD</span><strong>${keyword.difficulty ?? '不可用'}</strong></div><div><span>排名</span><strong>${keyword.currentRank ?? '未覆盖'}</strong></div><div><span>数据新鲜度</span><strong>${escapeHtml(freshness.label)}</strong></div></div><section class="client-overlay-section"><h3>主题簇优先映射</h3><dl class="client-detail-grid"><div><dt>主题簇</dt><dd>${escapeHtml(cluster?.label)}</dd></div><div><dt>页面角色</dt><dd>${escapeHtml(cluster?.roleLabel || cluster?.role)}</dd></div><div><dt>映射页面</dt><dd>${mappedPage}</dd></div><div><dt>主要 CTA</dt><dd>${escapeHtml(workspace.project.conversionGoals.find((item) => item.id === keyword.ctaId)?.label || '尚未映射')}</dd></div></dl></section><section class="client-overlay-section"><h3>入库路径</h3><div class="client-chip-row"><span>${escapeHtml(sourceLabels[keyword.sourceKind] || sourceRoute.label)}</span>${visibleSources.map((source) => `<button data-action="open-source" data-id="${source.id}">${escapeHtml(source.name)}</button>`).join('')}<span>${internalSignalCount(keyword.sourceRefs)} 条系统证据</span></div><p class="client-honesty-note">最旧有效来源观察时间：${escapeHtml(freshness.label)}。缺失指标保持“未连接 / 不可用 / 未覆盖”，不会写成 0。</p></section><section class="client-overlay-section"><h3>同主题簇查询</h3><div class="client-compact-list">${related.map((item) => `<button data-action="open-keyword" data-id="${item.id}"><strong>${escapeHtml(item.text)}</strong><small>${intentLabels[item.intent] || item.intent} · 搜索量 ${metricValue(item.volume, '未连接')}</small>${icon('arrow')}</button>`).join('')}</div></section>`, { drawer: true, footer: `<button class="button button--primary" data-action="go-keyword-artifact" data-cluster="${keyword.clusterId}">查看相关交付物</button>` });
  }

  function renderKeywordAdd() {
    return overlayFrame('添加关键词', '手工信号会保留来源与入库回执', `<form id="keyword-add-form" data-form="keyword-add" class="client-form"><label><span>关键词</span><input data-autofocus name="text" required placeholder="例如 onboarding workflow automation"></label><div class="client-form-grid"><label><span>市场</span><select name="market"><option value="US">美国</option><option value="UK">英国</option><option value="AU">澳大利亚</option></select></label><label><span>搜索意图</span><select name="intent"><option value="commercial">商业意图</option><option value="informational">信息意图</option><option value="comparison">对比意图</option><option value="implementation">实施意图</option></select></label><label><span>主题簇</span><select name="clusterId">${workspace.clusters.map((item) => `<option value="${item.id}">${escapeHtml(item.label)}</option>`).join('')}</select></label><label><span>映射 URL</span><select name="mappedUrlId"><option value="">新内容 / 尚未映射</option>${workspace.urls.map((item) => `<option value="${item.id}">${escapeHtml(item.path)}</option>`).join('')}</select></label></div><label><span>入库说明</span><textarea name="note" required placeholder="这个关键词来自哪里，为什么值得加入？"></textarea></label></form>`, { footer: '<button class="button button--secondary" data-action="close-overlay">取消</button><button class="button button--primary" type="submit" form="keyword-add-form">加入关键词库</button>' });
  }

  function renderCompetitorDetail(id) {
    const item = byId(workspace.competitors, id);
    if (!item) return '';
    const sources = item.sourceRefs.map((source) => byId(workspace.dataSources, source)).filter(Boolean);
    return overlayFrame(item.name, item.domain, `<div class="client-competitor-score"><div><span>自然搜索重叠度</span><strong>${item.organicOverlapPct == null ? '数据不足' : `${item.organicOverlapPct}%`}</strong></div><div><span>共同关键词</span><strong>${metricValue(item.sharedKeywordCount, '采集中')}</strong></div><div><span>AI 引用</span><strong>${item.aiCitationCount == null ? '不可用' : `${item.aiCitationCount}/20`}</strong></div></div><section class="client-overlay-section"><h3>当前分析范围</h3><dl class="client-detail-grid"><div><dt>竞争关系</dt><dd>${escapeHtml(relationLabels[item.relation] || item.relation)}</dd></div><div><dt>分析范围</dt><dd>${escapeHtml(scopeLabels[item.analysisScope] || item.analysisScope)}</dd></div><div><dt>审核状态</dt><dd>${badge(statusLabel('competitorStatus', item.status), toneFor(item.status))}</dd></div><div><dt>对关键词缺口的影响</dt><dd>${item.status === 'approved' ? '已纳入' : item.status === 'candidate' ? '等待确认' : '不参与'}</dd></div></dl></section><section class="client-overlay-section"><h3>为什么被发现</h3><div class="client-evidence-list">${sources.map((source) => `<article><span>${badge(source.status === 'manual_snapshot' ? '人工确认' : '场景快照', 'neutral')}</span><div><h3>${escapeHtml(source.name)}</h3><p>${escapeHtml(source.recordScope)}</p></div></article>`).join('')}</div></section>`, { drawer: true, footer: `<button class="button button--primary" data-action="review-competitor" data-id="${item.id}">${item.status === 'candidate' ? '审核竞品范围' : '调整分析范围'}</button>` });
  }

  function renderCompetitorAdd() {
    return overlayFrame('添加竞品', '手工记录先以候选竞品入库', `<form id="competitor-add-form" data-form="competitor-add" class="client-form"><div class="client-form-grid"><label><span>公司名称</span><input data-autofocus name="name" required placeholder="例如 Dock"></label><label><span>域名</span><input name="domain" required placeholder="dock.us"></label><label><span>竞争关系</span><select name="relation"><option value="direct">直接竞品</option><option value="indirect">间接竞品</option><option value="status_quo">现状替代</option><option value="benchmark">行业标杆</option><option value="publisher">内容竞品</option></select></label><label><span>建议分析范围</span><select name="analysisScope"><option value="relevant_keywords">相关关键词</option><option value="full_domain">全站分析</option><option value="profile_only">仅画像参考</option></select></label></div><label><span>加入理由</span><textarea name="note" required placeholder="用户提及、销售反馈、SERP 重复出现等"></textarea></label></form>`, { footer: '<button class="button button--secondary" data-action="close-overlay">取消</button><button class="button button--primary" type="submit" form="competitor-add-form">创建候选竞品</button>' });
  }

  function renderCompetitorReview(id) {
    const item = byId(workspace.competitors, id);
    if (!item) return '';
    const reviewNote = item.status === 'candidate'
      ? item.organicOverlapPct == null
        ? '该候选由客户手动加入；请基于业务关系确认是否进入正式分析，外部指标仍在采集。'
        : `基于 ${item.organicOverlapPct}% 自然搜索重叠度与 ${item.sharedKeywordCount} 个共同关键词进行审核。`
      : '调整竞品与关键词分析的参与范围。';
    return overlayFrame('确认竞品范围', `${item.name} · ${item.domain}`, `<form id="competitor-review-form" data-form="competitor-review" class="client-form"><input type="hidden" name="id" value="${item.id}"><label><span>审核决定</span><select name="status"><option value="approved" ${item.status === 'approved' ? 'selected' : ''}>确认并纳入分析</option><option value="candidate" ${item.status === 'candidate' ? 'selected' : ''}>保留为候选竞品</option><option value="excluded" ${item.status === 'excluded' ? 'selected' : ''}>排除</option></select></label><label><span>分析范围</span><select name="analysisScope"><option value="full_domain" ${item.analysisScope === 'full_domain' ? 'selected' : ''}>全站分析</option><option value="relevant_keywords" ${item.analysisScope === 'relevant_keywords' ? 'selected' : ''}>只分析相关关键词</option><option value="profile_only" ${item.analysisScope === 'profile_only' ? 'selected' : ''}>只用于画像</option><option value="excluded" ${item.analysisScope === 'excluded' ? 'selected' : ''}>不参与分析</option></select></label><label><span>审核说明</span><textarea name="note" required>${escapeHtml(reviewNote)}</textarea></label><div class="client-decision-impact"><strong>这个决定会影响</strong><span>关键词缺口、内容对比、AI 引用基准和对比页面证据。</span></div></form>`, { footer: '<button class="button button--secondary" data-action="close-overlay">取消</button><button class="button button--primary" type="submit" form="competitor-review-form">确认并生成回执</button>' });
  }

  function renderFindingReview(id) {
    const item = byId(workspace.findings, id);
    if (!item) return overlayFrame('未找到 Finding', '证据审核', '<div class="empty-state">这条待审核证据已不存在或不在当前项目中。</div>');
    const opportunity = workspace.opportunities.find((candidate) => candidate.findingIds.includes(item.id));
    const evidenceRows = Object.entries(item.evidence || {}).map(([key, value]) => `<div><dt>${escapeHtml(key.replace(/([A-Z])/g, ' $1'))}</dt><dd>${escapeHtml(value)}</dd></div>`).join('');
    return overlayFrame('审核 Finding', `${labels.lens[item.lens]} · ${item.severity.toUpperCase()}`, `<form id="finding-review-form" data-form="finding-review" class="client-form"><input type="hidden" name="id" value="${item.id}"><div class="client-confirm-object"><strong>${escapeHtml(item.title)}</strong><span>${item.urlIds.map(urlName).join(', ')}</span></div><section class="client-overlay-section"><h3>可复查证据</h3><dl class="client-detail-grid">${evidenceRows}<div><dt>来源</dt><dd>${item.sourceRefs.map(sourceName).join(' · ')}</dd></div></dl></section><label><span>审核决定</span><select name="decision"><option value="confirmed">确认问题并纳入增长机会</option><option value="dismissed">排除，不进入执行</option></select></label><label><span>审核说明</span><textarea name="note" required>已核对页面证据、来源与影响范围。</textarea></label><div class="client-decision-impact"><strong>关联机会</strong><span>${escapeHtml(opportunity?.title || '确认后将建立新的增长机会')}。确认会进入增长地图；排除会保留证据与审核记录，但不进入执行。</span></div></form>`, { footer: '<button class="button button--secondary" data-action="close-overlay">取消</button><button class="button button--primary" type="submit" form="finding-review-form">保存决定并生成回执</button>' });
  }

  function renderOpportunityDecision(id) {
    const item = byId(workspace.opportunities, id);
    if (!item) return overlayFrame('未找到机会', '机会决策', '<div class="empty-state">这条机会已不存在或不在当前项目中。</div>');
    const primaryFinding = byId(workspace.findings, item.findingIds[0]);
    return overlayFrame('记录机会决定', `${item.priority.toUpperCase()} · ${labels.lens[item.lens]}`, `<form id="opportunity-decision-form" data-form="opportunity-decision" class="client-form"><input type="hidden" name="id" value="${item.id}"><div class="client-confirm-object"><strong>${escapeHtml(item.title)}</strong><span>${item.urlIds.map(urlName).join(' · ')}</span></div><section class="client-overlay-section"><h3>主要问题</h3><p>${escapeHtml(primaryFinding?.title || '尚未绑定主要问题')}</p></section><label><span>下一步决定</span><select name="decision"><option value="confirmed" ${item.status === 'confirmed' ? 'selected' : ''}>确认，进入执行准备</option><option value="needs_data" ${item.status === 'needs_data' ? 'selected' : ''}>需要更多数据，暂不执行</option><option value="dismissed" ${item.status === 'dismissed' ? 'selected' : ''}>排除，不进入执行</option></select></label><label><span>决策说明</span><textarea name="note" required>已核对目标、主要问题、支撑证据与限制条件。</textarea></label><div class="client-decision-impact"><strong>状态影响</strong><span>确认会保留或建立执行链；需要更多数据会回到数据准备；排除会保留证据和审计记录，但不会进入执行。</span></div></form>`, { footer: '<button class="button button--secondary" data-action="close-overlay">取消</button><button class="button button--primary" type="submit" form="opportunity-decision-form">保存决定</button>' });
  }

  function renderOpportunity(id) {
    const item = byId(workspace.opportunities, id);
    if (!item) return overlayFrame('未找到关联机会', '增长机会', '<div class="empty-state">当前记录没有已建立的增长机会。</div>', { drawer: true });
    const findings = item.findingIds.map((findingId) => byId(workspace.findings, findingId)).filter(Boolean);
    const artifacts = item.artifactIds.map((artifactId) => byId(workspace.artifacts, artifactId)).filter(Boolean);
    return overlayFrame(item.title, `${item.priority.toUpperCase()} · ${labels.lens[item.lens]}`, `<div class="client-opportunity-status"><div><span>状态</span><strong>${statusLabel('opportunityStatus', item.status)}</strong></div><div><span>目标 URL</span><strong>${item.urlIds.length}</strong></div><div><span>问题数量</span><strong>${findings.length}</strong></div><div><span>交付物</span><strong>${artifacts.length}</strong></div></div><section class="client-overlay-section"><h3>问题与支撑证据</h3><div class="client-evidence-list">${findings.map((finding) => `<article><span>${badge(finding.severity.toUpperCase(), finding.severity === 'high' ? 'warning' : 'neutral')}</span><div><h3>${escapeHtml(finding.title)}</h3><p>${finding.urlIds.map(urlName).join(', ')} · ${finding.sourceRefs.map(sourceName).join(' · ')}</p></div></article>`).join('')}</div></section><section class="client-overlay-section"><h3>已生成的交付物</h3><div class="client-compact-list">${artifacts.map((artifact) => `<button data-action="go-artifact" data-id="${artifact.id}"><strong>${escapeHtml(artifact.title)}</strong><small>${artifactTypeLabels[artifact.type]} · ${statusLabel('artifactStatus', artifact.status)}</small>${icon('arrow')}</button>`).join('') || '<p>这个机会尚未生成交付物。</p>'}</div></section>`, { drawer: true, footer: artifacts.length ? `<button class="button button--primary" data-action="go-artifact" data-id="${artifacts[0].id}">打开执行物</button>` : `<button class="button button--primary" data-action="create-artifact" data-id="${item.id}">创建执行物</button>` });
  }

  function renderTaskPreview(payload) {
    const { kind, id } = payload || {};
    let title = '待处理事项';
    let description = '';
    let target = '';
    if (kind === 'artifact') {
      const item = byId(workspace.artifacts, id); title = item?.title; description = '打开实际交付内容，检查门禁、证据和目标 URL 后完成审核。'; target = 'execution';
    } else if (kind === 'competitor') {
      const item = byId(workspace.competitors, id); title = `审核 ${item?.name} 的竞品范围`; description = '决定该域名是否参与 Keyword Gap、内容对比和 AI citation benchmark。'; target = 'competitor';
    } else {
      const item = byId(workspace.findings, id); title = item?.title; description = '查看页面证据，并确认它是否应该形成正式增长机会。'; target = 'finding';
    }
    return overlayFrame(title || '待处理事项', '下一步动作', `<div class="client-task-preview"><span class="client-task-preview__number">01</span><h3>你将要做什么</h3><p>${escapeHtml(description)}</p><div><span>完成后</span><strong>状态、审计事件和下游对象会同步更新</strong></div></div>`, { footer: '<button class="button button--secondary" data-action="close-overlay">稍后处理</button><button class="button button--primary" data-action="task-go" data-kind="' + kind + '" data-id="' + id + '" data-target="' + target + '">开始处理</button>' });
  }

  function renderArtifactCreate(id) {
    const opportunity = byId(workspace.opportunities, id);
    if (!opportunity) return overlayFrame('未找到增长机会', '创建执行物', '<div class="empty-state">该机会不存在或已不在当前项目范围内。</div>');
    const primaryFinding = byId(workspace.findings, opportunity.findingIds[0]);
    const recommended = opportunity.lens === 'webtech' ? 'code_patch' : opportunity.lens === 'landing' ? 'landing_revision' : 'content_brief';
    const options = [
      ['content_brief', '内容 Brief'],
      ['english_blog_draft', 'English Blog'],
      ['code_patch', '代码修复'],
      ['schema_patch', 'Schema 修复'],
      ['metadata_rewrite', 'Metadata 重写'],
      ['landing_revision', 'Landing 页面改版'],
      ['comparison_brief', '竞品对比 Brief'],
    ];
    return overlayFrame('从机会创建执行物', `${opportunity.priority.toUpperCase()} · ${labels.lens[opportunity.lens]}`, `<form id="artifact-create-form" data-form="artifact-create" class="client-form"><input type="hidden" name="opportunityId" value="${opportunity.id}"><div class="client-confirm-object"><strong>${escapeHtml(opportunity.title)}</strong><span>${opportunity.urlIds.map(urlName).join(' · ')}</span></div><label><span>交付物类型</span><select name="type">${options.map(([value, label]) => `<option value="${value}" ${recommended === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label><label><span>交付物标题</span><input name="title" value="${escapeHtml(`${opportunity.title} · 执行方案`)}" required></label><label><span>负责人</span><input name="owner" value="${escapeHtml(artifactOwners[recommended])}" required></label><label><span>执行摘要</span><textarea name="summary" rows="4" required>基于已确认的主要问题、支撑证据与目标 URL，生成客户可审核的执行方案。</textarea></label><div class="client-run-preview"><div><span>主要问题</span><strong>${escapeHtml(primaryFinding?.title || '待补充')}</strong></div><div><span>目标 URLs</span><strong>${opportunity.urlIds.length}</strong></div><div><span>来源证据</span><strong>${opportunity.findingIds.flatMap((findingId) => byId(workspace.findings, findingId)?.sourceRefs || []).filter((value, index, list) => list.indexOf(value) === index).length} 条</strong></div></div><div class="client-honesty-note">创建后会把交付物追加到机会与执行中心，并建立 Revision 1；不会调用外部 CMS 或 GitHub。</div></form>`, { wide: true, footer: '<button class="button button--secondary" data-action="close-overlay">取消</button><button class="button button--primary" type="submit" form="artifact-create-form">创建并打开执行物</button>' });
  }

  function renderArtifactHistory(id) {
    const artifact = byId(workspace.artifacts, id);
    const revisions = workspace.artifactRevisions.filter((item) => item.artifactId === id).sort((a, b) => Number(b.revision) - Number(a.revision));
    if (!artifact) return overlayFrame('未找到交付物', '版本历史', '<div class="empty-state">该交付物不存在或不在当前项目中。</div>', { drawer: true });
    return overlayFrame('交付物版本历史', `${artifactTypeLabels[artifact.type] || artifact.type} · 追加式不可变记录`, `<div class="client-version-list">${revisions.map((revision) => `<button data-action="open-artifact-revision" data-id="${revision.id}"><span>${badge(Number(revision.revision) === Number(artifact.revision) ? '当前 Revision' : '历史 Revision', Number(revision.revision) === Number(artifact.revision) ? 'success' : 'neutral')}</span><strong>Revision ${revision.revision} · ${escapeHtml(revision.title || artifact.title)}</strong><small>${dateZh(revision.createdAt)} · ${escapeHtml(revision.changeNote)}</small>${icon('arrow')}</button>`).join('')}</div><div class="client-honesty-note">每个 Revision 都保存标题、客户可见内容、门禁快照、目标 URL 与来源证据；历史版本不可覆盖。</div>`, { drawer: true, footer: `<button class="button button--primary" data-action="go-artifact" data-id="${artifact.id}">返回当前 Revision</button>` });
  }

  function renderArtifactRevision(id) {
    const revision = byId(workspace.artifactRevisions, id);
    if (!revision) return overlayFrame('未找到 Revision', '版本历史', '<div class="empty-state">该版本记录不存在。</div>');
    const artifact = byId(workspace.artifacts, revision.artifactId);
    const revisionTitle = revision.title || artifact?.title || `Revision ${revision.revision}`;
    const historicalArtifact = { ...artifact, ...clone(revision), id: revision.artifactId, revision: revision.revision, title: revisionTitle, documentId: revision.documentId, generatedContent: revision.generatedContent };
    return overlayFrame(revisionTitle, `Revision ${revision.revision} · 只读快照`, `<section class="client-revision-snapshot"><dl class="client-detail-grid"><div><dt>创建时间</dt><dd>${dateZh(revision.createdAt)}</dd></div><div><dt>创建者</dt><dd>${escapeHtml(revision.createdBy)}</dd></div><div><dt>当时状态</dt><dd>${escapeHtml(statusLabel('artifactStatus', revision.statusAtCreation))}</dd></div><div><dt>目标 URLs</dt><dd>${revision.targetUrlIds.map(urlName).join(' · ')}</dd></div></dl><div class="client-revision-note"><span>Revision ${revision.revision} 修订摘要</span><strong>${escapeHtml(revision.revisionNote)}</strong><small>${escapeHtml(revision.changeNote)}</small></div><div class="client-document-body">${artifactDocument(historicalArtifact)}</div><section class="client-overlay-section"><h3>门禁快照</h3><div class="client-chip-row">${revision.requiredGates.map((gate) => `<span>${revision.passedGates.includes(gate) ? '✓' : '○'} ${escapeHtml(qualityGateLabels[gate] || gate)}</span>`).join('')}</div></section></section>`, { wide: true, footer: `<button class="button button--primary" data-action="open-artifact-history" data-id="${revision.artifactId}">返回版本历史</button>` });
  }

  function renderArtifactShare(id) {
    const item = byId(workspace.artifacts, id);
    return overlayFrame('模拟分享交付物', artifactTypeLabels[item?.type], `<form id="artifact-share-form" data-form="artifact-share" class="client-form"><input type="hidden" name="id" value="${id}"><div class="client-honesty-note"><strong>离线场景：</strong>这里演示权限、收件人与审计逻辑；不会创建真实可访问链接，也不会发送邮件。</div><label><span>模拟访问权限</span><select name="access"><option value="reviewers">仅指定审核人</option><option value="workspace">项目成员</option><option value="link">持模拟地址者可查看</option></select></label><label><span>模拟审核人邮箱</span><input name="recipients" type="email" value="review@relayops.com" required></label><label><span>模拟有效期</span><select name="expiry"><option value="7">7 天</option><option value="14">14 天</option><option value="30">30 天</option></select></label><label><span>附言</span><textarea name="note">请重点审核事实准确性、品牌语气与发布范围。</textarea></label><div class="client-share-preview"><span>模拟分享对象</span><strong>${escapeHtml(item?.title)}</strong><small>Revision ${item?.revision} · 只读预览 · 仅写入当前浏览器会话的演示审计记录</small></div></form>`, { footer: '<button class="button button--secondary" data-action="close-overlay">取消</button><button class="button button--primary" type="submit" form="artifact-share-form">生成模拟分享预览</button>' });
  }

  function renderArtifactEdit(id) {
    const item = byId(workspace.artifacts, id);
    if (!item) return overlayFrame('未找到交付物', '版本修订', '<div class="empty-state">这份交付物已不存在或不在当前项目中。</div>');
    const hadApproval = ['approved', 'published'].includes(item.status) || item.passedGates.includes('human');
    return overlayFrame('创建新 Revision', `${artifactTypeLabels[item.type]} · 当前 v${item.revision}`, `<form id="artifact-edit-form" data-form="artifact-edit" class="client-form"><input type="hidden" name="id" value="${item.id}"><label><span>交付物标题</span><input name="title" value="${escapeHtml(item.title)}" required></label><label><span>本次客户可见修订摘要</span><textarea name="revisionSummary" rows="5" required>${escapeHtml(item.revisionNote || '更新正文、实现说明或验收条件，并保留上一版本作为不可变历史。')}</textarea></label><label><span>变更说明</span><textarea name="changeNote" rows="3" required>${escapeHtml(item.changeNote || '根据最新审核意见创建下一版本。')}</textarea></label><div class="client-run-preview"><div><span>新版本</span><strong>Revision ${item.revision + 1}</strong></div><div><span>当前状态</span><strong>${statusLabel('artifactStatus', item.status)}</strong></div><div><span>批准状态</span><strong>${hadApproval ? '保存后失效' : '仍需审核'}</strong></div></div><div class="client-honesty-note">保存会创建新的客户可见 Revision，不覆盖历史版本。若旧版本曾被批准或发布，历史发布记录仍可查看，但不能代表新 Revision 已获批准。</div></form>`, { wide: true, footer: '<button class="button button--secondary" data-action="close-overlay">取消</button><button class="button button--primary" type="submit" form="artifact-edit-form">保存 Revision</button>' });
  }

  function renderArtifactApprove(id) {
    const item = byId(workspace.artifacts, id);
    return overlayFrame('批准交付物', artifactTypeLabels[item?.type], `<form id="artifact-approve-form" data-form="artifact-approve" class="client-form"><input type="hidden" name="id" value="${id}"><div class="client-confirm-object"><strong>${escapeHtml(item?.title)}</strong><span>Revision ${item?.revision} · ${item?.targetUrlIds.map(urlName).join(', ')}</span></div><label class="client-check-row"><input type="checkbox" name="confirmed" required><span>我已检查正文、证据来源、目标 URL 与发布范围。</span></label><label><span>审批备注</span><textarea name="note" required>内容与事实范围已确认，可以进入发布准备。</textarea></label><div class="client-decision-impact"><strong>批准后</strong><span>人工审核门禁将通过，交付物状态更新为“已批准”，并写入审核人、时间与审计事件。</span></div></form>`, { footer: '<button class="button button--secondary" data-action="close-overlay">取消</button><button class="button button--primary" type="submit" form="artifact-approve-form">确认批准</button>' });
  }

  function renderArtifactPublish(id) {
    const item = byId(workspace.artifacts, id);
    return overlayFrame('模拟发布确认', artifactTypeLabels[item?.type], `<form id="artifact-publish-form" data-form="artifact-publish" class="client-form"><input type="hidden" name="id" value="${id}"><div class="client-confirm-object"><strong>${escapeHtml(item?.title)}</strong><span>${item?.targetUrlIds.map(urlName).join(', ')}</span></div><div class="client-approval-invalidated"><strong>场景模拟</strong><span>这个动作只更新当前静态 Artifact 的内存状态并生成演示回执，不会连接真实 CMS、GitHub 或第三方服务。</span></div><dl class="client-detail-grid"><div><dt>模拟目标</dt><dd>场景 CMS / 部署适配器</dd></div><div><dt>观察窗口</dt><dd>发布后固定 28 天</dd></div><div><dt>回滚策略</dt><dd>生成唯一回滚引用</dd></div><div><dt>外部写入</dt><dd>不会发生</dd></div></dl><label class="client-check-row"><input type="checkbox" name="confirmed" required><span>我确认这是模拟发布，并已核对 Tracking 与回滚范围。</span></label><label><span>发布备注</span><textarea name="note">已批准交付物将在确定性场景工作区中模拟发布。</textarea></label></form>`, { footer: '<button class="button button--secondary" data-action="close-overlay">取消</button><button class="button button--primary" type="submit" form="artifact-publish-form">模拟发布并生成回执</button>' });
  }

  function renderReceipt(payload) {
    const receipt = typeof payload === 'object' ? payload : workspace.releases.find((item) => item.artifactId === payload);
    if (!receipt) return overlayFrame('尚无回执', '操作回执', '<div class="empty-state">这个对象还没有生成回执。</div>');
    const artifact = byId(workspace.artifacts, receipt.artifactId);
    const title = receipt.kind === 'blocked' ? '操作已阻断' : receipt.kind === 'share' ? '模拟分享预览已生成' : receipt.kind === 'keyword' ? '关键词已入库' : receipt.kind === 'competitor' ? '竞品记录已创建' : receipt.kind === 'sync' ? '数据更新已完成' : receipt.kind === 'review' ? '审核决定已记录' : receipt.simulated || seed.datasetKind === 'scenario' ? '模拟发布回执' : '发布回执';
    const receiptIcon = receipt.kind === 'blocked' ? '<span class="receipt-check is-blocked">!</span>' : `<span class="receipt-check">${icon('check')}</span>`;
    const copyLabel = receipt.copyFailed ? '复制失败，请手动复制' : receipt.copiedAt ? '已复制模拟地址' : receipt.scenarioOnly ? '复制模拟预览地址' : '复制访问链接';
    const nextAction = receipt.opportunityId ? `<button class="button button--primary button--full" data-action="open-opportunity" data-id="${receipt.opportunityId}">打开关联机会 ${icon('arrow')}</button>` : receipt.artifactId && byId(workspace.artifacts, receipt.artifactId) ? `<button class="button button--secondary button--full" data-action="go-artifact" data-id="${receipt.artifactId}">打开关联交付物 ${icon('arrow')}</button>` : '';
    return overlayFrame(title, receipt.id, `<div class="client-receipt">${receiptIcon}<h3>${escapeHtml(receipt.subject || artifact?.title || title)}</h3><p>${escapeHtml(receipt.message || '状态、对象关系与审计事件已在当前工作区更新。')}</p>${receipt.scenarioOnly ? '<div class="client-honesty-note"><strong>不可外部访问：</strong>以下地址仅用于演示复制与审计交互，不会打开真实页面，也没有发送给任何收件人。</div>' : ''}<dl><div><dt>回执 ID</dt><dd>${escapeHtml(receipt.id)}</dd></div><div><dt>创建时间</dt><dd>${dateZh(receipt.createdAt || receipt.publishedAt)}</dd></div>${receipt.scopes?.length ? `<div><dt>报告范围</dt><dd>${receipt.scopes.map((scope) => escapeHtml(scope)).join(' · ')}</dd></div>` : ''}${receipt.url ? `<div><dt>${receipt.scenarioOnly ? '模拟预览地址（不可外部访问）' : '访问链接'}</dt><dd><code>${escapeHtml(receipt.url)}</code></dd></div>` : ''}${receipt.rollbackRef ? `<div><dt>${receipt.simulated || seed.datasetKind === 'scenario' ? '模拟回滚引用' : '回滚引用'}</dt><dd><code>${escapeHtml(receipt.rollbackRef)}</code></dd></div>` : ''}${receipt.targetUrl ? `<div><dt>目标</dt><dd>${escapeHtml(receipt.targetUrl)}</dd></div>` : ''}</dl>${receipt.url ? `<button class="button button--secondary button--full" data-action="copy-receipt-link" data-url="${escapeHtml(receipt.url)}">${copyLabel}</button>` : ''}${nextAction}</div>`, { footer: '<button class="button button--primary" data-action="close-overlay">完成</button>' });
  }

  function renderResultPage(id) {
    const observation = (activeResultsRecord().pageObservations || []).find((item) => item.id === id);
    if (!observation) return '';
    const url = byId(workspace.urls, observation.urlId);
    const freshness = sourceFreshness(observation.sourceRefs);
    const window = activeResultWindow();
    const metricLabels = { clicks: '自然搜索点击', conversions: '转化', aiCitations: 'AI 引用' };
    const limitation = observation.attributionBoundary || observation.limitation || observation.sample?.note || '“已观察”表示同一固定窗口内记录到变化，不代表由单一 Artifact 造成；动作回执也不等于效果结果。';
    return overlayFrame(url.title, `${url.path} · ${statusLabel('observationStatus', observation.status)}`, `<div class="client-result-numbers">${Object.entries(observation.metrics || {}).map(([name, pair]) => metricCompare(metricLabels[name] || name.replace(/([A-Z])/g, ' $1'), pair)).join('')}</div><dl class="client-detail-grid"><div><dt>基线窗口</dt><dd>${window.baseline.start}–${window.baseline.end}</dd></div><div><dt>当前窗口</dt><dd>${window.current.start}–${window.current.end}</dd></div><div><dt>来源</dt><dd>${observation.sourceRefs.map(sourceName).join(' · ') || '尚无可用观测来源'}</dd></div><div><dt>更新于</dt><dd>${escapeHtml(freshness.label)}</dd></div></dl><section class="client-overlay-section"><h3>关联增长机会</h3><div class="client-compact-list">${(observation.opportunityIds || []).map((oppId) => { const opp = byId(workspace.opportunities, oppId); return `<button data-action="open-opportunity" data-id="${oppId}"><strong>${escapeHtml(opp?.title)}</strong><small>${labels.lens[opp?.lens]} · ${statusLabel('opportunityStatus', opp?.status)}</small>${icon('arrow')}</button>`; }).join('') || '<p>这是未绑定增长机会的自然观察页。</p>'}</div></section><div class="client-honesty-note"><strong>归因限制：</strong>${escapeHtml(limitation)}${observation.sample ? ` 基线 ${observation.sample.beforeSessions} 个会话，当前 ${observation.sample.currentSessions} 个会话。` : ''}</div>`, { wide: true });
  }

  function renderCampaign(id) {
    const item = byId(workspace.campaigns, id);
    if (!item) return '';
    const url = byId(workspace.urls, item.landingUrlId);
    const freshness = sourceFreshness(item.sourceRefs);
    const window = activeResultWindow();
    return overlayFrame(item.campaign || `${item.source} 引荐`, `${item.source} / ${item.medium}`, `<div class="client-campaign-path"><span>${escapeHtml(item.source)}</span>${icon('arrow')}<span>${escapeHtml(item.content)}</span>${icon('arrow')}<button data-action="open-page" data-id="${url.id}">${escapeHtml(url.path)}</button></div><div class="client-result-numbers">${metricCompare('会话', item.metrics.sessions)}${metricCompare('直接转化', item.metrics.conversions)}${metricCompare('辅助转化', item.metrics.assistedConversions)}</div><section class="client-overlay-section"><h3>UTM 标识</h3><pre class="client-evidence-code"><code>utm_source=${escapeHtml(item.source)}\nutm_medium=${escapeHtml(item.medium)}\nutm_campaign=${escapeHtml(item.campaign || '(未标记)')}\nutm_content=${escapeHtml(item.content)}</code></pre></section><dl class="client-detail-grid"><div><dt>窗口</dt><dd>${window.baseline.start}–${window.current.end}</dd></div><div><dt>来源</dt><dd>${item.sourceRefs.map(sourceName).join(' · ')}</dd></div><div><dt>更新于</dt><dd>${escapeHtml(freshness.label)}</dd></div><div><dt>样本</dt><dd>固定场景快照 · Landing URL 稳定 ID</dd></div></dl><div class="client-honesty-note"><strong>归因限制：</strong>${escapeHtml(item.attributionBoundary || '该行来自 GA4 + UTM 场景快照；直接 / 辅助转化只用于描述当前归因模型，不证明单一 Campaign 造成全部增量。')}</div>`, { wide: true });
  }

  function renderReportShare() {
    const window = activeResultWindow();
    return overlayFrame('模拟分享结果报告', `${window.baseline.start}–${window.baseline.end} 对比 ${window.current.start}–${window.current.end}`, `<form id="report-share-form" data-form="report-share" class="client-form"><div class="client-honesty-note"><strong>离线场景：</strong>这里演示当前固定窗口的报告范围、权限和审计逻辑；不会创建真实可访问链接，也不会发送邮件。动作回执不等于效果，窗口变化不归因给单一交付物。</div><label><span>模拟访问权限</span><select name="access"><option value="workspace">项目成员</option><option value="reviewers">指定收件人</option><option value="link">持模拟地址者可查看</option></select></label><label><span>模拟收件人</span><input name="recipients" type="email" value="leadership@relayops.com" required></label><label><span>模拟有效期</span><select name="expiry"><option value="7">7 天</option><option value="30">30 天</option><option value="90">90 天</option></select></label><fieldset><legend>包含范围</legend><label class="client-check-row"><input type="checkbox" checked name="scope" value="summary"> 结果摘要</label><label class="client-check-row"><input type="checkbox" checked name="scope" value="pages"> URL 改前 / 改后</label><label class="client-check-row"><input type="checkbox" checked name="scope" value="campaigns"> Campaign / UTM</label><label class="client-check-row"><input type="checkbox" checked name="scope" value="limitations"> 观察结论限制</label></fieldset></form>`, { footer: '<button class="button button--secondary" data-action="close-overlay">取消</button><button class="button button--primary" type="submit" form="report-share-form">生成模拟报告预览</button>' });
  }

  function renderAuditEvent(id) {
    const event = byId(workspace.auditEvents, id);
    if (!event) return '';
    return overlayFrame(eventLabels[event.type] || event.type, dateZh(event.at), `<dl class="client-detail-grid"><div><dt>事件 ID</dt><dd><code>${escapeHtml(event.id)}</code></dd></div><div><dt>操作者</dt><dd>${escapeHtml(event.actorId)}</dd></div><div><dt>操作者类型</dt><dd>${escapeHtml(event.actorType)}</dd></div><div><dt>关联对象数</dt><dd>${event.objectRefs.length}</dd></div></dl><section class="client-overlay-section"><h3>关联对象</h3><div class="client-chip-row">${event.objectRefs.map((ref) => `<span>${escapeHtml(ref)}</span>`).join('')}</div></section>`, { drawer: true });
  }

  function receipt(kind, fields = {}) {
    return { kind, id: `RCP-${kind.toUpperCase()}-${Date.now().toString().slice(-7)}`, createdAt: new Date().toISOString(), ...fields };
  }

  function handleAction(button) {
    const action = button.dataset.action;
    const id = button.dataset.id;
    if (action === 'nav') return setRoute(button.dataset.route);
    if (action === 'toggle-nav') {
      state.mobileNav = !state.mobileNav;
      render();
      window.requestAnimationFrame(() => (state.mobileNav ? document.querySelector('#primary-navigation .nav-item') : document.querySelector('.client-menu-button'))?.focus());
      return;
    }
    if (action === 'close-overlay') return closeOverlay();
    if (action === 'open-profile') return openOverlay('profile');
    if (action === 'edit-profile') return openOverlay('profile-edit');
    if (action === 'open-profile-evidence') return openOverlay('profile-evidence');
    if (action === 'open-profile-history') return openOverlay('profile-history');
    if (action === 'open-profile-version') return openOverlay('profile-version', { id });
    if (action === 'open-connections') return openOverlay('connections');
    if (action === 'open-source') return openOverlay('source-detail', { id });
    if (action === 'start-sync') return openOverlay('sync-run');
    if (action === 'open-page-filters') return openOverlay('page-filters');
    if (action === 'clear-page-filters') {
      state.pageTemplateFilter = 'all';
      state.pageClusterFilter = 'all';
      state.pageStatusFilter = 'all';
      state.pageLensFilter = 'all';
      state.pages.pages = 1;
      state.urlFlags.pageTemplate = false;
      state.urlFlags.pageCluster = false;
      state.urlFlags.pageStatus = false;
      state.urlFlags.pageLens = false;
      state.urlFlags.pageNumber.pages = false;
      return closeOverlay();
    }
    if (action === 'toggle-page-rows') {
      state.pageRowsExpanded = !state.pageRowsExpanded;
      state.urlFlags.pageRowsExpanded = true;
      return commitState('replace');
    }
    if (action === 'map-tab') {
      state.mapTab = button.dataset.tab;
      state.pages[state.mapTab] = 1;
      state.urlFlags.mapTab = true;
      state.urlFlags.pageNumber[state.mapTab] = false;
      state.urlFlags.selection[state.mapTab] = false;
      return commitState('push');
    }
    if (action === 'page-search') {
      state.pages.pages = 1;
      state.urlFlags.search.pages = true;
      state.urlFlags.pageNumber.pages = false;
      state.urlFlags.selection.pages = false;
      return commitState('push');
    }
    if (action === 'page-view') {
      state.pageView = button.dataset.view;
      state.pages.pages = 1;
      state.urlFlags.pageView = true;
      state.urlFlags.pageNumber.pages = false;
      state.urlFlags.selection.pages = false;
      return commitState('push');
    }
    if (action === 'keyword-source') {
      state.keywordSource = button.dataset.source;
      state.pages.keywords = 1;
      state.urlFlags.keywordSource = true;
      state.urlFlags.pageNumber.keywords = false;
      state.urlFlags.selection.keywords = false;
      return commitState('push');
    }
    if (action === 'select-map-page') return selectMapObject('selectedPageId', id);
    if (action === 'select-map-cluster') return selectMapObject('selectedClusterId', id);
    if (action === 'select-map-opportunity') return selectMapObject('selectedOpportunityId', id);
    if (action === 'open-cluster-page' || action === 'open-opportunity-page') {
      state.pageView = 'url';
      state.selectedPageId = id;
      state.pageTypeFilter = 'all';
      state.searches.pages = '';
      state.pages.pages = 1;
      state.urlFlags.pageView = true;
      state.urlFlags.selection.pages = true;
      state.urlFlags.pageType = false;
      state.urlFlags.search.pages = false;
      state.urlFlags.pageNumber.pages = false;
      return commitState('push');
    }
    if (action === 'select-map-keyword') return selectMapObject('selectedKeywordId', id);
    if (action === 'select-map-competitor') return selectMapObject('selectedCompetitorId', id);
    if (action === 'page-change') {
      const kind = button.dataset.kind;
      state.pages[kind] = Math.max(1, state.pages[kind] + Number(button.dataset.delta));
      state.urlFlags.pageNumber[kind] = true;
      state.urlFlags.selection[kind] = false;
      return commitState('push');
    }
    if (action === 'open-page') {
      if (!byId(workspace.urls, id)) {
        return openOverlay('receipt', receipt('blocked', {
          subject: '尚未映射到现有 URL',
          message: '该对象目前指向新内容或尚未映射，不能打开页面证据。',
        }));
      }
      return openOverlay('page-evidence', { id });
    }
    if (action === 'evidence-tab') { state.evidenceTab = button.dataset.tab; return commitState('replace'); }
    if (action === 'open-keyword') return openOverlay('keyword-detail', { id });
    if (action === 'add-keyword') return openOverlay('keyword-add');
    if (action === 'open-competitor') return openOverlay('competitor-detail', { id });
    if (action === 'add-competitor') return openOverlay('competitor-add');
    if (action === 'review-competitor') return openOverlay('competitor-review', { id });
    if (action === 'review-finding') return openOverlay('finding-review', { id });
    if (action === 'go-competitors') return setRoute('growth-map', { mapTab: 'competitors' });
    if (action === 'artifact-filter') {
      state.artifactFilter = button.dataset.filter;
      state.urlFlags.artifactFilter = true;
      state.urlFlags.artifactSelection = false;
      return commitState('push');
    }
    if (action === 'select-artifact') {
      state.selectedArtifactId = id;
      state.urlFlags.artifactSelection = true;
      return commitState('push');
    }
    if (action === 'open-opportunity') return openOverlay('opportunity', { id });
    if (action === 'decide-opportunity') return openOverlay('opportunity-decision', { id });
    if (action === 'create-artifact') return openOverlay('artifact-create', { id });
    if (action === 'go-artifact') return setRoute('execution', { selectedArtifactId: id, artifactFilter: 'all' });
    if (action === 'go-keyword-artifact') {
      const keywordUrls = workspace.keywords.filter((item) => item.clusterId === button.dataset.cluster).map((item) => item.mappedUrlId).filter(Boolean);
      const item = workspace.artifacts.find((artifact) => artifact.targetUrlIds.some((urlId) => keywordUrls.includes(urlId)));
      if (item) return setRoute('execution', { selectedArtifactId: item.id, artifactFilter: 'all' });
      return openOverlay('receipt', receipt('review', { subject: '尚无相关交付物', message: '这个主题簇已正式入库，但当前还没有生成交付物。' }));
    }
    if (action === 'share-artifact') return openOverlay('artifact-share', { id });
    if (action === 'edit-artifact') return openOverlay('artifact-edit', { id });
    if (action === 'open-artifact-history') return openOverlay('artifact-history', { id });
    if (action === 'open-artifact-revision') return openOverlay('artifact-revision', { id });
    if (action === 'approve-artifact') return openOverlay('artifact-approve', { id });
    if (action === 'publish-artifact') return openOverlay('artifact-publish', { id });
    if (action === 'open-receipt') {
      const found = workspace.releases.find((item) => item.artifactId === id) || (id === 'art-publish-automation' ? receipt('publish', { id: 'RCP-PUBLISH-20260601-021', artifactId: id, publishedAt: '2026-06-01T03:06:00.000Z', targetUrl: '/blog/customer-onboarding-automation/', rollbackRef: 'RB-2026-06-01-021', message: '文章已发布，固定 28 天观察窗口已建立。' }) : null);
      return openOverlay('receipt', found);
    }
    if (action === 'result-tab') {
      state.resultTab = button.dataset.tab;
      state.urlFlags.resultTab = true;
      return commitState('push');
    }
    if (action === 'open-result-page') return openOverlay('result-page', { id });
    if (action === 'open-campaign') return openOverlay('campaign', { id });
    if (action === 'share-report') {
      state.urlFlags.resultWindow = true;
      return openOverlay('report-share');
    }
    if (action === 'open-task') return openOverlay('task-preview', { kind: button.dataset.kind, id });
    if (action === 'task-go') {
      if (button.dataset.kind === 'artifact') return setRoute('execution', { selectedArtifactId: id, artifactFilter: 'all' });
      if (button.dataset.kind === 'competitor') return openOverlay('competitor-review', { id });
      return openOverlay('finding-review', { id });
    }
    if (action === 'open-audit-event') return openOverlay('audit-event', { id });
    if (action === 'copy-receipt-link') {
      const current = state.overlayPayload;
      if (!current || typeof current !== 'object') return;
      if (!navigator.clipboard?.writeText) {
        current.copyFailed = true;
        return render();
      }
      navigator.clipboard.writeText(button.dataset.url).then(() => {
        current.copiedAt = new Date().toISOString();
        current.copyFailed = false;
        render();
      }).catch(() => {
        current.copyFailed = true;
        render();
      });
      return;
    }
  }

  function handleForm(form) {
    const values = Object.fromEntries(new FormData(form).entries());
    if (form.dataset.form === 'page-filters') {
      state.pageTemplateFilter = values.template;
      state.pageClusterFilter = values.cluster;
      state.pageStatusFilter = values.status;
      state.pageLensFilter = values.lens;
      state.pages.pages = 1;
      state.urlFlags.pageTemplate = values.template !== 'all';
      state.urlFlags.pageCluster = values.cluster !== 'all';
      state.urlFlags.pageStatus = values.status !== 'all';
      state.urlFlags.pageLens = values.lens !== 'all';
      state.urlFlags.pageNumber.pages = false;
      state.urlFlags.selection.pages = false;
      return closeOverlay();
    }
    if (form.dataset.form === 'profile-edit') {
      const previous = workspace.profile;
      const next = clone(previous);
      const asLines = (value) => String(value || '').split('\n').map((item) => item.trim()).filter(Boolean);
      next.oneLiner = values.oneLiner.trim();
      next.valueProposition = values.valueProposition.trim();
      const businessLabels = { b2b_saas_subscription: '企业软件订阅制', transaction: '交易抽成', freemium: 'Freemium', hybrid: '混合模式' };
      const marketLabels = { US: '美国', UK: '英国', AU: '澳大利亚', Global: '全球英语市场' };
      next.businessModel = typeof previous.businessModel === 'object'
        ? { ...previous.businessModel, type: values.businessModel, label: businessLabels[values.businessModel] }
        : businessLabels[values.businessModel];
      next.primaryMarket = typeof previous.primaryMarket === 'object'
        ? { ...previous.primaryMarket, countryCode: values.primaryMarket, geography: marketLabels[values.primaryMarket] }
        : values.primaryMarket;
      next.offer = typeof previous.offer === 'object'
        ? { ...previous.offer, coreProduct: values.offer.trim() }
        : values.offer.trim();
      next.primaryIcp.company = values.company.trim();
      next.primaryIcp.buyer = values.buyer.trim();
      next.primaryIcp.champion = values.champion.trim();
      next.primaryIcp.users = values.users.split(',').map((item) => item.trim()).filter(Boolean);
      next.primaryIcp.jobsToBeDone = asLines(values.jobs);
      next.primaryIcp.buyingTriggers = asLines(values.triggers);
      next.primaryIcp.pains = asLines(values.pains);
      next.primaryIcp.useCases = asLines(values.useCases);
      next.buyingTriggers = clone(next.primaryIcp.buyingTriggers);
      next.pains = clone(next.primaryIcp.pains);
      next.useCases = clone(next.primaryIcp.useCases);
      next.version = Number(previous.version) + 1;
      next.confirmedAt = new Date().toISOString();
      next.confirmedBy = 'customer-user';
      const changedValues = {
        businessModel: next.businessModel?.label || next.businessModel,
        offer: next.offer?.coreProduct || next.offer,
        primaryMarket: next.primaryMarket?.geography || next.primaryMarket,
        buyer: next.primaryIcp.buyer,
        users: next.primaryIcp.users,
        JTBD: next.primaryIcp.jobsToBeDone,
        buyingTriggers: next.primaryIcp.buyingTriggers,
        pains: next.primaryIcp.pains,
        useCases: next.primaryIcp.useCases,
      };
      next.profileFields = profileFieldRecords(next).map((field) => {
        if (!(field.key in changedValues)) return field;
        return { ...field, value: clone(changedValues[field.key]), status: 'confirmed', confidence: 'high', derivation: '客户在产品画像审核中直接确认。', evidenceRefs: [...new Set([...(field.evidenceRefs || []), 'src-manual-profile'])] };
      });
      workspace.profile = next;
      const versionId = `${next.id}-v${next.version}`;
      const previousVersionId = workspace.profileVersions.at(-1)?.id || null;
      workspace.profileVersions.push({ id: versionId, version: next.version, confirmedAt: next.confirmedAt, confirmedBy: next.confirmedBy, previousVersionId, snapshot: clone(next) });
      recordEvent('profile_confirmed', [next.id, versionId]);
      return openOverlay('receipt', receipt('review', { subject: `产品画像 v${next.version}`, message: `新版本已追加，v${previous.version} 仍保留为只读历史；后续机会判断将引用 v${next.version}。` }));
    }
    if (form.dataset.form === 'keyword-add') {
      const id = `kw-manual-${Date.now()}`;
      workspace.keywords.unshift({
        id, projectId: workspace.project.id, text: values.text.trim(), sourceKind: 'manual', sourceRefs: ['src-manual-profile'],
        status: 'new', clusterId: values.clusterId, mappedUrlId: values.mappedUrlId || null, ctaId: workspace.project.primaryConversionId,
        intent: values.intent, market: values.market, volume: null, difficulty: null, currentRank: null, note: values.note.trim(),
      });
      recordEvent('keyword_added', [id]);
      state.pages.keywords = 1;
      return openOverlay('receipt', receipt('keyword', { subject: values.text.trim(), message: '关键词已以 Manual source 入库，并保留 Cluster、Mapped URL 与入库说明。' }));
    }
    if (form.dataset.form === 'competitor-add') {
      const id = `cmp-manual-${Date.now()}`;
      workspace.competitors.unshift({ id, projectId: workspace.project.id, name: values.name.trim(), domain: values.domain.trim().replace(/^https?:\/\//, '').replace(/\/$/, ''), relation: values.relation, analysisScope: values.analysisScope, status: 'candidate', sourceRefs: ['src-manual-profile'], organicOverlapPct: null, sharedKeywordCount: null, aiCitationCount: null, note: values.note.trim() });
      recordEvent('competitor_reviewed', [id]);
      state.pages.competitors = 1;
      return openOverlay('receipt', receipt('competitor', { subject: `${values.name.trim()} · 竞品候选`, message: '竞品已入库，但在审核确认前不会参与 Keyword Gap 或竞品对比证据。' }));
    }
    if (form.dataset.form === 'competitor-review') {
      const item = byId(workspace.competitors, values.id);
      item.status = values.status;
      item.analysisScope = values.status === 'excluded' ? 'excluded' : values.analysisScope;
      item.reviewedAt = new Date().toISOString();
      item.reviewedBy = 'customer-user';
      item.reviewNote = values.note.trim();
      recordEvent('competitor_reviewed', [item.id]);
      return openOverlay('receipt', receipt('review', { subject: `${item.name} · ${statusLabel('competitorStatus', item.status)}`, message: item.status === 'approved' ? '已纳入 Keyword Gap、内容对比和 AI 引用基准。' : item.status === 'excluded' ? '已从分析范围排除，历史证据仍保留。' : '继续保留为竞品候选，不参与正式差距计算。' }));
    }
    if (form.dataset.form === 'finding-review') {
      const item = byId(workspace.findings, values.id);
      const opportunity = workspace.opportunities.find((candidate) => candidate.findingIds.includes(item.id));
      const targetUrl = byId(workspace.urls, item.urlIds[0]);
      item.status = values.decision;
      item.reviewedAt = new Date().toISOString();
      item.reviewedBy = 'customer-user';
      item.reviewNote = values.note.trim();
      if (opportunity) opportunity.status = values.decision === 'confirmed' ? 'confirmed' : 'dismissed';
      if (targetUrl) targetUrl.status = values.decision === 'confirmed' ? 'action_required' : 'monitoring';
      recordEvent(values.decision === 'confirmed' ? 'finding_confirmed' : 'finding_reviewed', [item.id, ...(opportunity ? [opportunity.id] : []), ...item.urlIds]);
      return openOverlay('receipt', receipt('review', { opportunityId: values.decision === 'confirmed' ? opportunity?.id : null, subject: `${item.title} · ${statusLabel('findingStatus', item.status)}`, message: values.decision === 'confirmed' ? `Finding 已确认，关联机会“${opportunity?.title || '待建立'}”已进入增长地图；可继续打开机会并创建执行物。` : 'Finding 已排除，不会进入执行；原始证据、审核说明与审计事件仍然保留。' }));
    }
    if (form.dataset.form === 'opportunity-decision') {
      const item = byId(workspace.opportunities, values.id);
      item.status = values.decision;
      item.reviewedAt = new Date().toISOString();
      item.reviewedBy = 'customer-user';
      item.reviewNote = values.note.trim();
      recordEvent('opportunity_reviewed', [item.id, ...item.findingIds, ...item.urlIds]);
      const messages = {
        confirmed: '机会已确认，可以沿现有动作 / 交付物链进入执行准备。',
        needs_data: '机会已标记为需要更多数据；不会进入执行，后续更新会保留本次决策记录。',
        dismissed: '机会已排除；支撑证据与审核记录仍然保留。',
      };
      return openOverlay('receipt', receipt('review', { subject: `${item.title} · ${statusLabel('opportunityStatus', item.status)}`, message: messages[item.status] }));
    }
    if (form.dataset.form === 'artifact-create') {
      const opportunity = byId(workspace.opportunities, values.opportunityId);
      if (!opportunity) return openOverlay('receipt', receipt('blocked', { subject: '尚未创建执行物', message: '关联增长机会不存在，当前没有写入交付物。' }));
      const findings = opportunity.findingIds.map((findingId) => byId(workspace.findings, findingId)).filter(Boolean);
      const primaryFinding = findings[0];
      const sourceRefs = [...new Set(findings.flatMap((finding) => finding.sourceRefs))];
      const gateConfig = {
        english_blog_draft: ['research', 'seo', 'geo', 'factual', 'human'],
        content_brief: ['research', 'seo', 'human'],
        comparison_brief: ['research', 'factual', 'legal', 'human'],
        code_patch: ['technical', 'human'],
        schema_patch: ['technical', 'factual', 'human'],
        metadata_rewrite: ['seo', 'factual', 'human'],
        landing_revision: ['research', 'seo', 'tracking', 'human'],
      };
      const requiredGates = gateConfig[values.type] || ['research', 'human'];
      const passedGates = requiredGates.filter((gate) => gate !== 'human');
      const now = new Date().toISOString();
      const id = `art-created-${Date.now()}`;
      const item = {
        id,
        projectId: workspace.project.id,
        opportunityId: opportunity.id,
        title: values.title.trim(),
        type: values.type,
        status: 'review',
        revision: 1,
        targetUrlIds: clone(opportunity.urlIds),
        sourceRefs,
        owner: values.owner.trim(),
        requiredGates,
        passedGates,
        revisionNote: '由已确认增长机会生成首个客户可见版本。',
        changeNote: values.summary.trim(),
        createdAt: now,
        updatedAt: now,
        generatedContent: {
          objective: opportunity.title,
          summary: values.summary.trim(),
          primaryFinding: primaryFinding?.title || '需要补充主要 Finding',
          evidence: findings.map((finding) => `${finding.title}；来源：${finding.sourceRefs.map(sourceName).join('、')}`),
          steps: opportunity.lens === 'webtech'
            ? ['确认受影响模板与 URL 范围', '实施最小可回滚代码变更', '运行 rendered crawl 与验收断言', '通过人工审核后进入 GitHub PR 流程']
            : ['确认目标搜索意图与 ICP / JTBD', '建立内容或页面结构', '核对事实、内链、CTA 与追踪计划', '通过人工审核后进入模拟发布'],
          acceptance: opportunity.lens === 'webtech'
            ? ['所有目标 URL 均通过技术断言', '没有产生新的重复项、可索引性或 Schema 回归', '回滚引用已明确']
            : ['目标 Keyword、ICP、意图和 CTA 映射一致', '所有事实均有已批准来源', '发布前门禁与固定观察窗口已建立'],
          limitation: (opportunity.coverageAndLimitations || ['当前证据只覆盖场景快照中的目标 URL。']).join('；'),
          rollback: '若验收失败，恢复上一 Revision，并保留本次执行与复查记录。',
        },
      };
      workspace.artifacts.unshift(item);
      opportunity.artifactIds.push(item.id);
      opportunity.status = 'in_execution';
      workspace.artifactRevisions.push(artifactRevisionSnapshot(item, { createdAt: now, createdBy: 'customer-user' }));
      recordEvent('action_created', [opportunity.id, item.id, ...item.targetUrlIds]);
      state.selectedArtifactId = item.id;
      state.artifactFilter = 'all';
      return setRoute('execution', { selectedArtifactId: item.id, artifactFilter: 'all' });
    }
    if (form.dataset.form === 'artifact-edit') {
      const index = workspace.artifacts.findIndex((artifact) => artifact.id === values.id);
      const current = workspace.artifacts[index];
      if (!current) return openOverlay('receipt', receipt('blocked', { subject: '尚未创建 Revision', message: '交付物不存在，当前版本历史没有变化。' }));
      const oldRevision = current.revision;
      const nextRevision = Number(current.revision) + 1;
      const hadApproval = ['approved', 'published'].includes(current.status) || current.passedGates.includes('human');
      const currentDocument = workspace.artifactDocuments.find((document) => document.id === current.documentId);
      const nextDocument = currentDocument ? {
        ...clone(currentDocument),
        id: `doc-${current.id}-r${nextRevision}`,
        revision: nextRevision,
        revisionId: `rev-${current.id}-r${nextRevision}`,
        title: values.title.trim(),
        revisionReview: {
          label: 'Revision Review / 版本审核',
          revision: nextRevision,
          decision: '待审核',
          reviewedBy: '尚未完成人工审核',
          reviewedAt: null,
          note: values.revisionSummary.trim(),
        },
        releaseAndResults: {
          label: 'Publish / Change Receipt 与 Results / 效果结果',
          releaseIds: [],
          observationIds: [],
          campaignIds: [],
          receiptStatement: '这个新 Revision 尚无 Publish / Change Receipt。',
          attributionBoundary: seed.attributionBoundary || '动作回执不等于效果，固定窗口观察不归因给单一交付物。',
        },
      } : null;
      const next = {
        ...clone(current),
        title: values.title.trim(),
        revision: nextRevision,
        documentId: nextDocument?.id || current.documentId,
        revisionIds: [...(current.revisionIds || []), `rev-${current.id}-r${nextRevision}`],
        revisionNote: values.revisionSummary.trim(),
        changeNote: values.changeNote.trim(),
        status: 'review',
        updatedAt: new Date().toISOString(),
        passedGates: current.passedGates.filter((gate) => gate !== 'human'),
        approvedAt: null,
        approvedBy: null,
        approvalInvalidatedAt: hadApproval ? new Date().toISOString() : current.approvalInvalidatedAt,
      };
      workspace.artifacts.splice(index, 1, next);
      if (nextDocument) workspace.artifactDocuments.push(nextDocument);
      workspace.artifactRevisions.push(artifactRevisionSnapshot(next, { createdAt: next.updatedAt, createdBy: 'customer-user' }));
      recordEvent('artifact_revised', [next.id, `revision:${oldRevision}`, `revision:${next.revision}`]);
      return openOverlay('receipt', receipt('review', { artifactId: next.id, subject: `${next.title} · Revision ${next.revision}`, message: hadApproval ? `新 Revision 已追加；Revision ${oldRevision} 的批准状态已失效，历史发布与 Revision 快照均保留为只读记录。` : `新 Revision 已追加，交付物已进入审核状态。` }));
    }
    if (form.dataset.form === 'artifact-share') {
      const item = byId(workspace.artifacts, values.id);
      const result = receipt('share', { artifactId: item.id, subject: item.title, scenarioOnly: true, simulated: true, url: `local-artifact://preview/artifacts/${item.id}?r=${item.revision}`, message: `已为“${values.recipients}”生成仅限当前浏览器会话的模拟只读预览，有效期参数为 ${values.expiry} 天；没有创建真实链接，也没有发送邮件。` });
      workspace.shareReceipts.push(result);
      recordEvent('report_shared', [item.id, result.id]);
      return openOverlay('receipt', result);
    }
    if (form.dataset.form === 'artifact-approve') {
      const item = byId(workspace.artifacts, values.id);
      const missingNonHumanGates = item.requiredGates.filter((gate) => gate !== 'human' && !item.passedGates.includes(gate));
      if (item.status !== 'review' || missingNonHumanGates.length) {
        return openOverlay('receipt', receipt('blocked', { subject: '批准被质量门禁阻断', message: missingNonHumanGates.length ? `仍需通过：${missingNonHumanGates.join(', ')}。状态没有发生变化。` : `当前状态为 ${statusLabel('artifactStatus', item.status)}，不能执行批准。` }));
      }
      item.status = 'approved';
      item.approvedAt = new Date().toISOString();
      item.approvedBy = 'customer-user';
      item.approvalNote = values.note.trim();
      item.approvalInvalidatedAt = null;
      if (!item.passedGates.includes('human')) item.passedGates.push('human');
      recordEvent('artifact_approved', [item.id]);
      return openOverlay('receipt', receipt('review', { subject: item.title, message: '交付物已批准，人工审核门禁已通过，现在可以进入发布确认。' }));
    }
    if (form.dataset.form === 'artifact-publish') {
      const item = byId(workspace.artifacts, values.id);
      const missingGates = item?.requiredGates.filter((gate) => !item.passedGates.includes(gate)) || [];
      if (!item || item.status !== 'approved' || missingGates.length) {
        return openOverlay('receipt', receipt('blocked', { subject: '发布被质量门禁阻断', message: !item ? '未找到要发布的交付物。' : missingGates.length ? `仍需通过：${missingGates.join(', ')}。没有创建发布记录，也没有改变交付物状态。` : `当前状态为 ${statusLabel('artifactStatus', item.status)}，必须先完成审核并批准。` }));
      }
      item.status = 'published';
      item.publishedAt = new Date().toISOString();
      const release = receipt('publish', { id: `REL-${Date.now().toString().slice(-8)}`, artifactId: item.id, revision: item.revision, simulated: true, publishedAt: item.publishedAt, targetUrl: urlName(item.targetUrlIds[0]), rollbackRef: `RB-${new Date().toISOString().slice(0, 10)}-${workspace.releases.length + 1}`, message: '场景模拟发布已完成：状态、回滚引用与固定观察窗口已在当前浏览器会话中建立；没有发生真实 CMS、GitHub 或第三方服务写入。' });
      workspace.releases.push(release);
      recordEvent('change_published', [item.id, release.id, ...item.targetUrlIds]);
      return openOverlay('receipt', release);
    }
    if (form.dataset.form === 'report-share') {
      const scopes = new FormData(form).getAll('scope');
      const reportScopeLabels = { summary: '结果摘要', pages: 'URL 改前 / 改后', campaigns: 'Campaign / UTM', limitations: '观察结论限制' };
      if (!scopes.length) return openOverlay('receipt', receipt('blocked', { subject: '尚未创建报告', message: '请至少选择一个报告范围；当前没有生成访问链接，也没有写入分享记录。' }));
      const selectedScopeLabels = scopes.map((scope) => reportScopeLabels[scope] || scope);
      const window = activeResultWindow();
      const result = receipt('share', { subject: `${workspace.project.name} · 效果追踪报告`, scopes: selectedScopeLabels, scenarioOnly: true, simulated: true, url: `local-artifact://preview/results/${workspace.project.slug}?window=${encodeURIComponent(window.id)}&scope=${encodeURIComponent(scopes.join(','))}`, message: `已为“${values.recipients}”生成 ${window.baseline.start}–${window.baseline.end} 对比 ${window.current.start}–${window.current.end} 的模拟报告预览，有效期参数为 ${values.expiry} 天；包含 ${selectedScopeLabels.join('、')}。没有创建真实链接，也没有发送邮件；动作回执不等于效果，固定窗口变化不归因给单一对象。` });
      workspace.shareReceipts.push(result);
      recordEvent('report_shared', [result.id, ...scopes.map((scope) => `scope:${scope}`)]);
      return openOverlay('receipt', result);
    }
    if (form.dataset.form === 'sync-run') {
      const selected = new FormData(form).getAll('sources');
      if (!selected.length) return openOverlay('receipt', receipt('blocked', { subject: '尚未运行更新', message: '请至少选择一个数据来源；当前没有更新时间，也没有创建同步事件。' }));
      const now = new Date().toISOString();
      selected.forEach((sourceId) => { const source = byId(workspace.dataSources, sourceId); if (source) source.observedAt = now; });
      const summary = derived();
      recordEvent('sync_completed', selected);
      return openOverlay('receipt', receipt('sync', { subject: `${selected.length} 个来源的新鲜度已更新`, message: `已刷新所选来源的观测时间，并重新计算工作区摘要：${summary.openOpportunities.length} 个开放机会、${summary.activeArtifacts.length} 个活跃交付物。场景对象数量未变化，也没有外部写入。` }));
    }
  }

  app.addEventListener('click', (event) => {
    const button = event.target.closest('[data-action]');
    if (!button || button.disabled) return;
    handleAction(button);
  });

  app.addEventListener('input', (event) => {
    const kind = event.target.dataset.search;
    if (!kind) return;
    state.searches[kind] = event.target.value;
    state.pages[kind] = 1;
    state.urlFlags.search[kind] = true;
    state.urlFlags.pageNumber[kind] = false;
    state.urlFlags.selection[kind] = false;
    commitState('replace');
    window.requestAnimationFrame(() => { const input = document.querySelector(`[data-search="${kind}"]`); if (input) { input.focus(); input.setSelectionRange(input.value.length, input.value.length); } });
  });

  app.addEventListener('change', (event) => {
    if (event.target.matches('[data-page-type-filter]')) {
      state.pageTypeFilter = event.target.value;
      state.pages.pages = 1;
      state.urlFlags.pageType = true;
      state.urlFlags.pageNumber.pages = false;
      state.urlFlags.selection.pages = false;
      return commitState('replace');
    }
    const sourceKind = event.target.dataset.sourceFilter;
    if (sourceKind === 'keywords') {
      state.keywordSource = event.target.value;
      state.pages.keywords = 1;
      state.urlFlags.keywordSource = true;
      state.urlFlags.pageNumber.keywords = false;
      state.urlFlags.selection.keywords = false;
      return commitState('replace');
    }
    const kind = event.target.dataset.filter;
    if (!kind) return;
    state.statusFilters[kind] = event.target.value;
    state.pages[kind] = 1;
    state.urlFlags.status[kind] = true;
    state.urlFlags.pageNumber[kind] = false;
    state.urlFlags.selection[kind] = false;
    commitState('replace');
  });

  app.addEventListener('submit', (event) => {
    const form = event.target.closest('[data-form]');
    if (!form) return;
    event.preventDefault();
    if (!form.reportValidity()) return;
    handleForm(form);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && state.overlay) {
      event.preventDefault();
      closeOverlay();
      return;
    }
    if (event.key === 'Escape' && state.mobileNav) {
      state.mobileNav = false;
      render();
      window.requestAnimationFrame(() => document.querySelector('.client-menu-button')?.focus());
      return;
    }
    const selectableRow = event.target.closest?.('.v14-page-table tbody tr[data-action][tabindex]');
    if (selectableRow && ['Enter', ' '].includes(event.key)) {
      event.preventDefault();
      handleAction(selectableRow);
      return;
    }
    const activeTab = event.target.closest?.('[role="tab"]');
    const tabKeys = ['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End'];
    if (activeTab && tabKeys.includes(event.key)) {
      const tabs = [...activeTab.closest('[role="tablist"]').querySelectorAll('[role="tab"]')];
      const currentIndex = tabs.indexOf(activeTab);
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : ['ArrowRight', 'ArrowDown'].includes(event.key) ? (currentIndex + 1) % tabs.length : (currentIndex - 1 + tabs.length) % tabs.length;
      const nextId = tabs[nextIndex].id;
      event.preventDefault();
      tabs[nextIndex].click();
      window.requestAnimationFrame(() => document.getElementById(nextId)?.focus());
      return;
    }
    if (event.key !== 'Tab') return;
    const container = state.overlay
      ? document.querySelector('.client-overlay [role="dialog"]')
      : state.mobileNav && window.matchMedia('(max-width: 760px)').matches
        ? document.querySelector('#primary-navigation')
        : null;
    if (!container) return;
    const focusable = [...container.querySelectorAll('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href]')];
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!container.contains(document.activeElement)) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  });

  window.addEventListener('popstate', reconcileLocation);
  window.addEventListener('hashchange', reconcileLocation);

  function render() {
    const views = { overview: renderOverview, 'growth-map': renderGrowthMap, execution: renderExecution, results: renderResults };
    app.innerHTML = shell((views[state.route] || renderOverview)());
    document.body.classList.toggle('has-client-overlay', Boolean(state.overlay));
    const sidebar = document.querySelector('#primary-navigation');
    if (sidebar && !state.overlay && window.matchMedia('(max-width: 760px)').matches && !state.mobileNav) {
      sidebar.setAttribute('inert', '');
      sidebar.setAttribute('aria-hidden', 'true');
    }
  }

  hydrateStateFromLocation();
  render();
  writeLocation('replace');
  if (state.overlay) focusOverlay();
}());
