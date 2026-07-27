(function startNevermoreIntegratedProduct(global) {
  "use strict";

  const PRODUCT_VIEW_IDS = ["overview", "growth-map", "execution", "results"];
  const VIEW_ICONS = {
    overview: "总",
    "growth-map": "图",
    execution: "执",
    results: "效",
  };
  const VIEW_SUBTITLES = {
    overview: "今天先做什么",
    "growth-map": "页面 · Topic · Keyword · Competitor",
    execution: "审核并处理交付物",
    results: "改前 / 改后与证据",
  };
  const TRUTH_LABELS = {
    current: "当前可用",
    next: "尚未启用",
    "provider-dependent": "需接入数据源",
    partial: "部分存在",
    planned: "已规划 · 待落地",
    unavailable: "当前不可用",
    "not-implemented": "尚未实现",
    "external-dependent": "依赖外部接入",
  };
  const CONNECTION_ORDER = ["gsc", "ga4", "github"];
  const DELIVERABLE_IDS = [
    "english-blog",
    "content-brief",
    "metadata",
    "technical-ticket-code-patch",
  ];
  const NATIVE_ENTRY_IDS = {
    "topic-governance": "topic-review",
    "keyword-relation-governance": "keyword-relationship-review",
    "voc-source-governance": "source-readiness",
    "artifact-source-provenance": "deliverable-sources",
    "action-blocker": "blocked-task",
    "action-business-progress": "task-progress",
    "opportunity-decision-sla": "pending-opportunity",
    "internal-link-graph": "internal-link-opportunity",
    "keyword-rank-history": "keyword-observation",
    "content-decay-monitor": "content-health-alert",
    "backlink-evidence": "backlink-readiness",
    "geo-citation-observation": "geo-evidence",
    "competitor-delta-monitor": "competitor-change",
  };
  const DEFAULT_STATE = {
    view: "overview",
    surface: "",
    entryId: "",
    capabilityId: "",
    deliverable: DELIVERABLE_IDS[0],
    target: "",
    drawer: "",
    auditRequirementId: 0,
  };

  let audit;
  let product;
  let app;
  let state = { ...DEFAULT_STATE };
  let dialogInvoker = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function text(value, fallback = "未提供") {
    const normalized = String(value ?? "").trim();
    return normalized || fallback;
  }

  function list(value) {
    if (Array.isArray(value)) {
      return value.filter((item) => item !== null && item !== undefined);
    }
    if (value === null || value === undefined || value === "") {
      return [];
    }
    return [value];
  }

  function itemLabel(item) {
    if (typeof item === "string" || typeof item === "number") {
      const canonicalObject = list(product?.canonicalObjects).find(
        (object) => object.id === String(item),
      );
      return text(canonicalObject?.name ?? item);
    }
    if (item && typeof item === "object") {
      return text(
        item.label ??
          item.name ??
          item.title ??
          item.trigger ??
          item.surface ??
          item.description ??
          item.purpose ??
          item.carries,
      );
    }
    return "未提供";
  }

  function renderList(items, className = "condition-list") {
    const normalized = list(items);
    if (normalized.length === 0) {
      return '<p data-reading-text>当前没有额外条目。</p>';
    }
    return `<ul class="${escapeHtml(className)}">${normalized
      .map((item) => `<li data-reading-text>${escapeHtml(itemLabel(item))}</li>`)
      .join("")}</ul>`;
  }

  function moduleById(moduleId) {
    return product.modules.find((module) => module.id === moduleId) ?? null;
  }

  function sectionById(module, sectionId) {
    return (
      list(module?.mainSections).find((section) => section.id === sectionId) ??
      null
    );
  }

  function capabilityById(capabilityId) {
    return (
      product.capabilities.find(
        (capability) => capability.id === String(capabilityId),
      ) ?? null
    );
  }

  function nativeEntryId(capability) {
    return (
      NATIVE_ENTRY_IDS[capability?.id] ??
      `workspace-item-${capability?.requirementId ?? "unknown"}`
    );
  }

  function capabilityByEntryId(entryId) {
    return (
      product.capabilities.find(
        (capability) => nativeEntryId(capability) === String(entryId),
      ) ?? null
    );
  }

  function requirementById(requirementId) {
    return (
      audit.requirements.find(
        (requirement) => requirement.id === Number(requirementId),
      ) ?? null
    );
  }

  function capabilityForRequirement(requirementId) {
    return (
      product.capabilities.find(
        (capability) =>
          capability.requirementId === Number(requirementId),
      ) ?? null
    );
  }

  function capabilityIdsForSection(module, section) {
    const sectionIds = list(section?.capabilityIds).map(String);
    if (sectionIds.length > 0) {
      return sectionIds;
    }
    return list(module?.capabilityIds).map(String);
  }

  function capabilitiesForSection(module, section) {
    const ids = new Set(capabilityIdsForSection(module, section));
    return product.capabilities.filter((capability) => ids.has(capability.id));
  }

  function capabilitiesForModule(module) {
    const primaryCapabilities = product.capabilities.filter(
      (capability) => capability.primaryModule === module?.id,
    );
    if (primaryCapabilities.length > 0) {
      return primaryCapabilities;
    }
    const ids = new Set(list(module?.capabilityIds).map(String));
    return product.capabilities.filter((capability) => ids.has(capability.id));
  }

  function firstSection(module) {
    return list(module?.mainSections)[0] ?? null;
  }

  function firstCapability(module, section) {
    return (
      capabilitiesForSection(module, section)[0] ??
      capabilitiesForModule(module)[0] ??
      null
    );
  }

  function truthLabel(status) {
    return TRUTH_LABELS[status] ?? text(status);
  }

  function truthDescription(status) {
    const productState = product.truthStates?.[status];
    if (typeof productState === "string") {
      return productState;
    }
    if (productState && typeof productState === "object") {
      return text(
        productState.description ?? productState.label ?? productState.name,
        truthLabel(status),
      );
    }
    return truthLabel(status);
  }

  function truthBadge(status) {
    return `<span class="truth-badge truth-badge--${escapeHtml(
      status,
    )}">${escapeHtml(truthLabel(status))}</span>`;
  }

  function deliveryStageLabel(stage) {
    const normalized = text(stage, "");
    const labels = {
      "stage-1": "已纳入本期范围",
      "stage-2": "进入后续迭代",
      "stage-3": "依赖外部条件",
    };
    return labels[normalized] ?? normalized;
  }

  function normalizeConnectionId(value) {
    return String(value ?? "")
      .trim()
      .toLowerCase()
      .replaceAll("google search console", "gsc")
      .replaceAll("google analytics 4", "ga4");
  }

  function connections() {
    const policy = product.connectorPolicy ?? audit.connectorPolicy ?? {};
    const candidates = Array.isArray(policy)
      ? policy
      : list(
          policy.connections ??
            policy.customerVisibleConnections ??
            policy.connectors ??
            policy.items,
        );

    const normalized = candidates
      .map((connection) => {
        if (typeof connection === "string") {
          const id = normalizeConnectionId(connection);
          return {
            id,
            name: connection,
            purpose: "客户可见数据连接",
            readiness: "next",
            unavailableText: "连接状态需由项目实际授权确认。",
          };
        }
        const id = normalizeConnectionId(
          connection.id ?? connection.name ?? connection.label,
        );
        return {
          ...connection,
          id,
          name: text(
            connection.name ?? connection.label,
            id.toUpperCase(),
          ),
          purpose: text(
            connection.purpose,
            "客户可见数据连接",
          ),
          truthStatus: text(
            connection.truthStatus ?? connection.status,
            "next",
          ),
          readiness: text(
            connection.readiness,
            "需要完成项目级授权与 Scope 校验。",
          ),
          unavailableText: text(
            connection.unavailableText,
            "尚未具备可验证的连接状态。",
          ),
        };
      })
      .filter((connection) => CONNECTION_ORDER.includes(connection.id));

    return CONNECTION_ORDER.map((id) =>
      normalized.find((connection) => connection.id === id),
    ).filter(Boolean);
  }

  function lifecycleSteps() {
    return list(product.lifecycle).map((step, index) => {
      if (typeof step === "string") {
        return { id: `lifecycle-${index + 1}`, label: step };
      }
      return {
        id: text(step.id, `lifecycle-${index + 1}`),
        label: text(
          step.label ?? step.name ?? step.title,
          `阶段 ${index + 1}`,
        ),
      };
    });
  }

  function encodeDestination(destination) {
    if (!destination) {
      return "";
    }
    const kind = text(destination.kind, "view");
    const target = text(destination.target, "current");
    return `${kind}:${target}`;
  }

  function primaryAction(record) {
    const action = record?.primaryAction;
    if (!action || !action.destination) {
      return null;
    }
    return {
      id: text(action.id),
      label: text(action.label),
      destination: action.destination,
      encodedDestination: encodeDestination(action.destination),
    };
  }

  function findDestinationRoute(destination) {
    const target = text(destination?.target, "");
    const kind = text(destination?.kind, "");

    if (
      ["audit", "audit-evidence", "evidence", "secondary-evidence"].includes(
        kind,
      )
    ) {
      return { drawer: "audit" };
    }
    if (["connections", "connection"].includes(kind)) {
      return { drawer: "connections" };
    }

    const directModule = moduleById(target);
    if (directModule) {
      return {
        view: directModule.id,
        surface: firstSection(directModule)?.id ?? "",
      };
    }

    for (const module of product.modules) {
      const directSection = sectionById(module, target);
      if (directSection) {
        return { view: module.id, surface: directSection.id };
      }
    }

    const tokens = target.split(/[/:#]/).filter(Boolean);
    const routedModule = tokens.map(moduleById).find(Boolean);
    if (routedModule) {
      const routedSection =
        tokens.map((token) => sectionById(routedModule, token)).find(Boolean) ??
        firstSection(routedModule);
      return {
        view: routedModule.id,
        surface: routedSection?.id ?? "",
      };
    }

    for (const module of product.modules) {
      const routedSection = tokens
        .map((token) => sectionById(module, token))
        .find(Boolean);
      if (routedSection) {
        return { view: module.id, surface: routedSection.id };
      }
    }

    return {};
  }

  function normalizeState(candidate) {
    const view = PRODUCT_VIEW_IDS.includes(candidate.view)
      ? candidate.view
      : "overview";
    const module = moduleById(view) ?? product.modules[0];
    const requestedSurface =
      view === "growth-map" && candidate.object
        ? candidate.object
        : candidate.surface;
    const section =
      sectionById(module, requestedSurface) ?? firstSection(module);
    const moduleCapabilities = capabilitiesForModule(module);
    const sectionCapabilities = capabilitiesForSection(module, section);
    const requestedCapability =
      capabilityByEntryId(candidate.entryId) ??
      capabilityById(candidate.capabilityId);
    const selectedCapability =
      requestedCapability &&
      sectionCapabilities.some(
        (capability) => capability.id === requestedCapability.id,
      )
        ? requestedCapability
        : sectionCapabilities[0] ??
          moduleCapabilities[0] ??
          capabilityById(list(module.capabilityIds)[0]) ??
          product.capabilities[0];

    return {
      view: module.id,
      surface: section?.id ?? "",
      entryId: selectedCapability ? nativeEntryId(selectedCapability) : "",
      capabilityId: selectedCapability?.id ?? "",
      deliverable: DELIVERABLE_IDS.includes(candidate.deliverable)
        ? candidate.deliverable
        : DELIVERABLE_IDS[0],
      target: text(candidate.target, ""),
      drawer: ["audit", "connections"].includes(candidate.drawer)
        ? candidate.drawer
        : "",
      auditRequirementId: requirementById(candidate.auditRequirementId)
        ? Number(candidate.auditRequirementId)
        : selectedCapability?.requirementId ?? audit.requirements[0].id,
    };
  }

  function parseHash() {
    const rawHash = global.location.hash.replace(/^#\/?/, "");
    const [rawView = "", rawQuery = ""] = rawHash.split("?");
    const params = new URLSearchParams(rawQuery);

    if (["requirements", "modules", "stages", "acceptance"].includes(rawView)) {
      const requirementId = Number(
        params.get("item") ?? audit.requirements[0].id,
      );
      const capability =
        capabilityForRequirement(requirementId) ?? product.capabilities[0];
      const module =
        moduleById(capability.primaryModule) ?? product.modules[0];
      const section =
        list(module.mainSections).find((item) =>
          list(item.capabilityIds).includes(capability.id),
        ) ?? firstSection(module);
      return normalizeState({
        view: module.id,
        surface: section?.id,
        entryId: nativeEntryId(capability),
        target: "",
        drawer: rawView === "requirements" ? "audit" : "",
        auditRequirementId: requirementId,
      });
    }

    return normalizeState({
      view: rawView || "overview",
      surface: params.get("surface") ?? "",
      object: params.get("object") ?? "",
      entryId: params.get("entry") ?? "",
      deliverable: params.get("deliverable") ?? DELIVERABLE_IDS[0],
      target: params.get("target") ?? "",
      drawer: params.get("drawer") ?? "",
      auditRequirementId: Number(params.get("audit") ?? 0),
    });
  }

  function stateHash(candidate) {
    const params = new URLSearchParams();
    params.set("surface", candidate.surface);
    if (candidate.view === "growth-map") {
      params.set("object", candidate.surface);
    }
    if (candidate.entryId) {
      params.set("entry", String(candidate.entryId));
    }
    if (
      candidate.view === "execution" &&
      DELIVERABLE_IDS.includes(candidate.deliverable)
    ) {
      params.set("deliverable", candidate.deliverable);
    }
    if (candidate.target) {
      params.set("target", candidate.target);
    }
    if (candidate.drawer) {
      params.set("drawer", candidate.drawer);
    }
    if (candidate.drawer === "audit" && candidate.auditRequirementId) {
      params.set("audit", String(candidate.auditRequirementId));
    }
    return `#/${candidate.view}?${params.toString()}`;
  }

  function commitState(patch, options = {}) {
    const nextState = normalizeState({ ...state, ...patch });
    const nextHash = stateHash(nextState);
    state = nextState;

    if (global.location.hash === nextHash) {
      render();
      return;
    }
    if (options.replace) {
      global.history.replaceState(null, "", nextHash);
      render();
      return;
    }
    global.location.hash = nextHash;
    render();
  }

  function renderShell() {
    document.title = "Nevermore · SEO/GEO 增长工作台";
    document.documentElement.lang = "zh-CN";
    app.innerHTML = `
      <div class="product-shell">
        <aside class="product-sidebar" aria-label="Nevermore 产品导航">
          <div class="brand">
            <span class="brand__mark" aria-hidden="true">G</span>
            <span>
              <span class="brand__name">GenGrowth</span>
              <span class="brand__tagline">海外增长工作台</span>
            </span>
          </div>
          <div class="project-identity">
            <span class="project-identity__eyebrow">Nevermore</span>
            <strong>统一 SEO/GEO 增长工作台</strong>
            <p>从 URL、关键词和技术证据，到交付物、发布回执与效果追踪。</p>
          </div>
          <nav class="workspace-nav" aria-label="客户工作区" tabindex="0">
            <p class="workspace-nav__label">客户工作区</p>
            ${product.modules
              .map(
                (module) => `
                  <button
                    type="button"
                    data-action="set-product-view"
                    data-product-view="${escapeHtml(module.id)}"
                    aria-label="${escapeHtml(module.name)}"
                  >
                    <span class="workspace-nav__icon" aria-hidden="true">${escapeHtml(
                      VIEW_ICONS[module.id] ?? "·",
                    )}</span>
                    <span class="workspace-nav__copy">
                      <strong>${escapeHtml(module.name)}</strong>
                    </span>
                  </button>
                `,
              )
              .join("")}
          </nav>
          <div class="sidebar-evidence">
            <span class="sidebar-evidence__label">审核证据</span>
            <p>查看原始需求审核、事实依据与验收边界。</p>
            <button
              type="button"
              data-product-action="open-audit-evidence"
              data-action="open-audit-evidence"
              data-governed-destination="evidence:requirements"
            >查看需求审核证据</button>
          </div>
        </aside>

        <div class="product-stage">
          <header class="product-topbar">
            <div class="breadcrumb">
              <span>Nevermore</span>
              <span class="breadcrumb__slash" aria-hidden="true">/</span>
              <strong data-breadcrumb-current>概览</strong>
            </div>
            <div class="connection-readiness" aria-label="数据连接就绪度">
              ${connections()
                .map(
                  (connection) => `
                    <button
                      class="connection-chip"
                      type="button"
                      data-action="open-connections"
                      data-governed-destination="connections:${escapeHtml(
                        connection.id,
                      )}"
                      data-connection-id="${escapeHtml(connection.id)}"
                      data-customer-connector="${escapeHtml(connection.name)}"
                      data-readiness="${escapeHtml(connection.truthStatus)}"
                    >
                      ${escapeHtml(connection.name)}
                      <span>${escapeHtml(
                        truthLabel(connection.truthStatus),
                      )}</span>
                    </button>
                  `,
                )
                .join("")}
              <button
                class="connection-more"
                type="button"
                data-action="open-connections"
                data-product-action="open-connections"
                data-governed-destination="connections:readiness"
                aria-label="查看数据连接说明"
              >···</button>
            </div>
          </header>
          <main id="product-content" data-product-surface="overview"></main>
        </div>
      </div>

      <dialog
        class="product-dialog"
        data-connections-dialog
        aria-modal="true"
        aria-labelledby="connections-dialog-title"
      >
        <div class="dialog-head">
          <div>
            <p class="dialog-head__eyebrow">Data readiness</p>
            <h2 id="connections-dialog-title">客户可见数据连接</h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            data-action="close-dialog"
            aria-label="关闭数据连接说明"
          >×</button>
        </div>
        <div
          class="dialog-body"
          data-connections-body
          role="region"
          aria-label="连接就绪度详情"
          tabindex="0"
        ></div>
        <div class="dialog-foot">
          <button class="product-button" type="button" data-action="close-dialog">
            返回工作区
          </button>
        </div>
      </dialog>

      <dialog
        class="product-dialog"
        data-audit-evidence-dialog
        data-secondary-evidence
        aria-modal="true"
        aria-labelledby="audit-dialog-title"
      >
        <div class="dialog-head">
          <div>
            <p class="dialog-head__eyebrow">Secondary evidence</p>
            <h2 id="audit-dialog-title">需求审核证据</h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            data-action="close-dialog"
            aria-label="关闭需求审核证据"
          >×</button>
        </div>
        <div
          class="dialog-body"
          data-audit-dialog-body
          role="region"
          aria-label="13 项需求审核证据"
          tabindex="0"
        ></div>
        <div class="dialog-foot">
          <button class="product-button" type="button" data-action="close-dialog">
            返回工作台
          </button>
        </div>
      </dialog>
    `;

    document.querySelectorAll("dialog").forEach((dialog) => {
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        commitState({ drawer: "" }, { replace: true });
      });
    });
  }

  function renderLifecycle() {
    const steps = lifecycleSteps();
    if (steps.length === 0) {
      return "";
    }
    return `
      <div class="lifecycle-strip" aria-label="统一增长生命周期">
        ${steps
          .map(
            (step, index) => `
              <div class="lifecycle-step">
                <span class="lifecycle-step__index" aria-hidden="true">${String(
                  index + 1,
                ).padStart(2, "0")}</span>
                <span>${escapeHtml(step.label)}</span>
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }

  function renderSurfaceTabs(module, activeSection) {
    const isGrowthMap = module.id === "growth-map";
    return `
      <div
        class="surface-tabs"
        role="tablist"
        aria-label="${escapeHtml(module.name)}页面结构"
      >
        ${list(module.mainSections)
          .map(
            (section) => `
              <button
                type="button"
                role="tab"
                data-action="set-surface"
                data-section-id="${escapeHtml(section.id)}"
                ${isGrowthMap ? `data-growth-object="${escapeHtml(section.id)}"` : ""}
                aria-selected="${section.id === activeSection.id ? "true" : "false"}"
                aria-controls="surface-panel-${escapeHtml(section.id)}"
                id="surface-tab-${escapeHtml(section.id)}"
              >${escapeHtml(section.title)}</button>
            `,
          )
          .join("")}
      </div>
    `;
  }

  function renderSectionPrimaryAction(section) {
    const action = primaryAction(section);
    if (!action) {
      return "";
    }
    return `
      <button
        class="product-button product-button--secondary"
        type="button"
        data-action="run-product-action"
        data-product-action="${escapeHtml(action.id)}"
        data-governed-destination="${escapeHtml(action.encodedDestination)}"
      >${escapeHtml(action.label)} →</button>
    `;
  }

  function renderNativeSectionActions(module, activeSection = null) {
    return `
      <div class="section-action-bar" aria-label="${escapeHtml(
        module.name,
      )}全部入口">
        ${list(module.mainSections)
          .map(
            (section) => `
              <div class="${
                section.id === activeSection?.id ? "is-active" : ""
              }">
                <span>${escapeHtml(section.title)}</span>
                ${renderSectionPrimaryAction(section)}
              </div>
            `,
          )
          .join("")}
      </div>
    `;
  }

  function renderNativeEntryList(module, selectedCapability, section) {
    const entries = capabilitiesForSection(module, section);
    return `
      <aside class="product-panel native-entry-panel" aria-label="${escapeHtml(
        module.name,
      )}工作入口">
        <div class="panel-head">
          <span class="panel-head__eyebrow">WORKSPACE</span>
          <h2>当前可以处理</h2>
          <p>选择一项，查看证据状态和下一步。</p>
        </div>
        <div class="native-entry-list">
          ${entries
            .map(
              (item) => `
                <button
                  class="capability-entry"
                  type="button"
                  data-action="select-native-entry"
                  data-native-entry
                  data-entry-id="${escapeHtml(nativeEntryId(item))}"
                  aria-current="${
                    item.id === selectedCapability.id ? "true" : "false"
                  }"
                >
                  <span class="native-entry-dot native-entry-dot--${escapeHtml(
                    item.truthStatus,
                  )}" aria-hidden="true"></span>
                  <span>
                    <span class="capability-entry__title">${escapeHtml(
                      item.title,
                    )}</span>
                    <span class="capability-entry__meta">${escapeHtml(
                      truthLabel(item.truthStatus),
                    )}</span>
                  </span>
                </button>
              `,
            )
            .join("")}
        </div>
      </aside>
    `;
  }

  function nativeReadinessCopy(capability) {
    const copy = {
      "topic-governance":
        "需要先确认产品画像并完成关键词入库。系统生成 Topic 草案后，由客户确认主题、页面归属和需要拆分或合并的关系。",
      "keyword-relation-governance":
        "需要有明确来源的关键词与目标页面。重复词、近义词和潜在蚕食只作为待审核建议，不会自动覆盖客户决定。",
      "voc-source-governance":
        "需要先确认允许使用的评论、访谈或社区来源及采集范围。未接入来源时只显示准备条件。",
      "artifact-source-provenance":
        "每份交付物需要关联可打开的参考来源、采集时间与适用限制；缺少来源时会保持待补充状态。",
      "action-blocker":
        "任务需要明确卡点、负责人、发现时间和解除方式。当前没有这些信息时，不会猜测阻断原因。",
      "action-business-progress":
        "任务只显示真实业务阶段和下一步；只有项目配置了正式步骤时，才会展示完成步数。",
      "opportunity-decision-sla":
        "需要先为项目确认决策时限和负责人。达到时限的机会可推进、拒绝、延后或暂缓。",
      "internal-link-graph":
        "需要完成页面与链接采集并确认覆盖范围。数据完整后才会识别 Hub、Spoke、单向和孤岛页面。",
      "keyword-rank-history":
        "需要连续的同市场、同设备排名观测。缺失日期不会补零，没有变更回执时也不会标记优化事件。",
      "content-decay-monitor":
        "需要足够长且口径一致的观测窗口，并通过样本量、季节性和缺数检查后才会产生提醒。",
      "backlink-evidence":
        "需要受治理文件导入或外部服务授权，并确认指标口径、采集频率和成本。未满足时保持不可用。",
      "geo-citation-observation":
        "需要外部服务提供 Query、回答快照、引用位置和采集时间。没有完整证据时不展示引用结论。",
      "competitor-delta-monitor":
        "需要客户确认竞品池，并建立可重复采集的前后快照。未授权来源不会生成模拟变化。",
    };
    return (
      copy[capability.id] ??
      "需要项目数据、客户确认和可复查证据齐备后，才会进入下一步。"
    );
  }

  function customerTruthCopy(status) {
    const copy = {
      current:
        "此模块已具备客户可用界面；具体项目内容仍以真实连接、采集结果和审核记录为准。",
      next: "此项当前尚未启用；页面会说明所需条件和下一步，在形成真实记录前不会显示为已完成。",
      "provider-dependent":
        "此项需要外部数据服务或受治理导入；未授权时只显示原因和接入入口。",
    };
    return copy[status] ?? "当前状态以项目证据为准。";
  }

  function renderNativeDetail(capability) {
    const action = primaryAction(capability);
    const targetAttribute = state.target
      ? ` data-governed-target="${escapeHtml(state.target)}"`
      : "";
    return `
      <section
        class="capability-detail native-detail"
        data-native-detail
        data-entry-id="${escapeHtml(nativeEntryId(capability))}"
        data-truth-status="${escapeHtml(capability.truthStatus)}"
        ${targetAttribute}
      >
        <div class="capability-detail__topline">
          <span class="capability-detail__id">当前工作项</span>
          ${truthBadge(capability.truthStatus)}
        </div>
        <h3>${escapeHtml(capability.title)}</h3>
        <p class="capability-detail__outcome" data-reading-text>${escapeHtml(
          capability.customerOutcome,
        )}</p>
        <div class="detail-grid">
          <section class="detail-block">
            <h4>当前状态</h4>
            <p data-reading-text>${escapeHtml(
              customerTruthCopy(capability.truthStatus),
            )}</p>
          </section>
          <section class="detail-block">
            <h4>开始前需要什么</h4>
            <p data-reading-text>${escapeHtml(nativeReadinessCopy(capability))}</p>
          </section>
          <section class="detail-block">
            <h4>下一步</h4>
            <p data-reading-text>${escapeHtml(
              action?.label ?? "返回当前工作区继续审核",
            )}</p>
          </section>
        </div>
        ${
          state.target
            ? `
              <div class="unavailable-note" data-reading-text>
                下一步已定位到对应工作区。系统会保留当前对象和证据状态，不会用成功提示替代真实处理结果。
              </div>
            `
            : ""
        }
        <div class="capability-actions">
          ${
            action
              ? `
                <button
                  class="product-button ${
                    capability.truthStatus === "provider-dependent"
                      ? "product-button--unavailable"
                      : ""
                  }"
                  type="button"
                  data-action="run-product-action"
                  data-native-next
                  data-product-action="${escapeHtml(action.id)}"
                  data-entry-id="${escapeHtml(nativeEntryId(capability))}"
                  data-governed-destination="${escapeHtml(
                    action.encodedDestination,
                  )}"
                >${escapeHtml(action.label)} →</button>
              `
              : ""
          }
        </div>
      </section>
    `;
  }

  function renderNativeOverview(module, activeSection, selectedCapability) {
    const copy = {
      "priority-queue": {
        label: "优先事项",
        title: "等待第一批可验证机会",
        body: "完成站点采集并接入可用数据后，这里会按证据完整度、影响范围与可执行性排序。没有证据时不会生成虚假优先级。",
      },
      "product-context": {
        label: "产品与 ICP",
        title: "先确认 URL 与核心业务信息",
        body: "系统会从产品 URL 建立产品类别、商业模式、目标客户、目标市场与 Conversion Goal 草案，客户只需审核和修正。",
      },
      "decision-reminders": {
        label: "待决策机会",
        title: "当前没有可核验的超时决策",
        body: "只有拥有稳定机会身份、Owner、SLA 和决策记录的项目，才会在这里显示推进、拒绝、延后或 Snooze。",
      },
      "health-alerts": {
        label: "健康提醒",
        title: "监控窗口尚未建立",
        body: "内容衰减与竞品变化必须基于真实前后窗口、样本和新鲜度；当前不会用示例百分比代替项目数据。",
      },
    };
    return `
      <section
        class="overview-grid"
        aria-label="项目概览"
        id="surface-panel-${escapeHtml(activeSection.id)}"
        role="tabpanel"
        aria-labelledby="surface-tab-${escapeHtml(activeSection.id)}"
        data-overview-workspace
      >
        ${list(module.mainSections)
          .map((section) => {
            const card = copy[section.id];
            return `
              <article class="overview-card ${
                section.id === activeSection.id ? "is-active" : ""
              }">
                <div class="overview-card__topline">
                  <span>${escapeHtml(card.label)}</span>
                  ${truthBadge(section.truthStatus)}
                </div>
                <h2>${escapeHtml(card.title)}</h2>
                <p data-reading-text>${escapeHtml(card.body)}</p>
                ${
                  section.id === "product-context"
                    ? `
                      <dl class="profile-summary">
                        <div><dt>产品 URL</dt><dd>待客户确认</dd></div>
                        <div><dt>产品类别</dt><dd>由 URL 建模后生成</dd></div>
                        <div><dt>ICP 与市场</dt><dd>审核后生效</dd></div>
                      </dl>
                      <div class="connector-summary">
                        ${connections()
                          .map(
                            (connection) => `
                              <span>
                                ${escapeHtml(connection.name)}
                                <b>${escapeHtml(
                                  truthLabel(connection.truthStatus),
                                )}</b>
                              </span>
                            `,
                          )
                          .join("")}
                      </div>
                    `
                    : `
                      <div
                        class="honest-empty"
                        data-honest-empty-state
                        data-evidence-status="unavailable"
                      >尚无该项目的可验证记录</div>
                    `
                }
                ${renderSectionPrimaryAction(section)}
              </article>
            `;
          })
          .join("")}
        <div class="native-function-workspace overview-grid__workflow">
          ${renderNativeEntryList(module, selectedCapability, activeSection)}
          ${renderNativeDetail(selectedCapability)}
        </div>
      </section>
    `;
  }

  function growthViewCopy(sectionId) {
    const views = {
      "page-portfolio": {
        eyebrow: "URL INVENTORY",
        title: "页面、问题与机会",
        columns: ["URL / 页面", "页面类型", "证据状态", "当前动作"],
        reason:
          "项目尚未产生站点快照。接入主站 URL 后，这里会逐页展示技术、内容、SEO 与 GEO 信号，并允许在多个 URL 之间切换详情。",
      },
      "keyword-library": {
        eyebrow: "KEYWORD LIBRARY",
        title: "关键词身份、来源与页面映射",
        columns: ["Keyword", "来源", "Intent / Topic", "目标页面"],
        reason:
          "当前没有入库关键词。关键词可来自已授权 GSC、竞品与 SERP 研究、内容差距、用户手动输入或受治理 CSV；每条都会保留来源和采集时间。",
      },
      "topic-governance": {
        eyebrow: "TOPIC GOVERNANCE",
        title: "Topic、页面归属与关系审核",
        columns: ["Topic", "待审核关键词", "页面归属", "关系决策"],
        reason:
          "Topic 草案尚未生成。系统需要先有产品画像与关键词语料，再由客户审核 Topic、页面归属、重复词和潜在蚕食关系。",
      },
      "competitor-corpus": {
        eyebrow: "COMPETITOR CORPUS",
        title: "直接竞品、间接竞品与证据来源",
        columns: ["竞品", "关系类型", "入库来源", "最近观测"],
        reason:
          "竞品池尚未建立。系统会从产品 URL、类别、目标市场和 SERP 候选生成初始池，客户也可以手动补充、排除或确认。",
      },
      "internal-link-graph": {
        eyebrow: "INTERNAL LINK GRAPH",
        title: "Hub、Spoke、单向与孤岛页面",
        columns: ["来源页面", "目标页面", "链接方向", "建议状态"],
        reason:
          "尚无完整页面与链接快照，无法生成可靠图谱。完成站点采集和覆盖率校验后才会显示结构与修复建议。",
      },
      "keyword-history": {
        eyebrow: "RANK HISTORY",
        title: "关键词趋势与变更事件",
        columns: ["Keyword", "市场 / 设备", "观测窗口", "变更回执"],
        reason:
          "当前没有连续排名观测。系统不会用零值补齐缺失日期，也不会在没有发布或变更回执时标注“优化后”。",
      },
      "external-evidence": {
        eyebrow: "EXTERNAL EVIDENCE",
        title: "VOC、GEO Citation 与 Backlink",
        columns: ["证据类型", "数据来源", "授权状态", "可用范围"],
        reason:
          "外部证据服务尚未授权。这里只显示接入范围、成本、指标口径与失败状态；未接入前不会展示模拟引用或外链数据。",
      },
    };
    return views[sectionId] ?? views["page-portfolio"];
  }

  function renderNativeGrowth(module, section, selectedCapability) {
    const copy = growthViewCopy(section.id);
    return `
      <section
        class="product-panel object-workspace"
        id="surface-panel-${escapeHtml(section.id)}"
        role="tabpanel"
        aria-labelledby="surface-tab-${escapeHtml(section.id)}"
        data-growth-workspace="${escapeHtml(section.id)}"
      >
        <header class="object-workspace__head">
          <div>
            <p class="panel-head__eyebrow">${escapeHtml(copy.eyebrow)}</p>
            <h2>${escapeHtml(copy.title)}</h2>
            <p data-reading-text>${escapeHtml(section.purpose)}</p>
          </div>
          ${truthBadge(section.truthStatus)}
        </header>
        <div class="object-table" data-native-object-list="${escapeHtml(
          section.id,
        )}">
          <div class="object-table__head">
            ${copy.columns
              .map((column) => `<span>${escapeHtml(column)}</span>`)
              .join("")}
          </div>
          <div
            class="honest-empty honest-empty--large"
            data-honest-empty-state
            data-evidence-status="unavailable"
          >
            <strong>等待真实项目数据</strong>
            <p data-reading-text>${escapeHtml(copy.reason)}</p>
            ${renderSectionPrimaryAction(section)}
          </div>
        </div>
        <div class="native-function-workspace object-workspace__workflow">
          ${renderNativeEntryList(module, selectedCapability, section)}
          ${renderNativeDetail(selectedCapability)}
        </div>
      </section>
      ${renderNativeSectionActions(module, section).replace(
        renderSectionPrimaryAction(section),
        "",
      )}
    `;
  }

  function renderDeliveryChecks() {
    return `
      <aside class="delivery-governance delivery-governance--inline" aria-label="交付审核状态">
        <div class="panel-head">
          <span class="panel-head__eyebrow">REVIEW</span>
          <h2>来源、QA 与回执</h2>
        </div>
        <div class="delivery-check" data-delivery-check="sources" data-evidence-status="pending">
          <strong>参考来源</strong>
          <span>待补充项目级来源</span>
          <p data-reading-text>正文结构已形成，但 URL 证据、竞品页面与外部引用仍需在客户项目中确认。</p>
        </div>
        <div class="delivery-check" data-delivery-check="qa" data-evidence-status="pending">
          <strong>质量检查</strong>
          <span>待审核</span>
          <p data-reading-text>需完成事实、搜索意图、ICP、内链、Metadata 与结构化数据检查。</p>
        </div>
        <div class="delivery-check" data-delivery-check="approval" data-evidence-status="pending">
          <strong>客户审批</strong>
          <span>尚未批准</span>
          <p data-reading-text>正文可以审阅，但没有任何发布授权或批准记录。</p>
        </div>
        <div class="delivery-check" data-delivery-check="publication-receipt" data-evidence-status="unavailable">
          <strong>发布 / 变更回执</strong>
          <span>不可用</span>
          <p data-reading-text>没有发布动作、GitHub PR 或变更回执，因此不会进入效果归因。</p>
        </div>
      </aside>
    `;
  }

  function renderDeliverableBody(deliverableId) {
    const bodies = {
      "english-blog": `
        <article
          class="deliverable-document deliverable-document--article"
          data-deliverable-body
          data-deliverable-type="english-blog"
          data-deliverable-status="pending-review"
          lang="en"
        >
          <div class="deliverable-document__status">英文 Blog · 待审核</div>
          <h2>How a Unified SEO and GEO Workflow Turns Website Evidence Into Accountable Growth Actions</h2>
          <p class="deliverable-lede" data-reading-text>
            Growth teams rarely lack ideas. They lack a reliable path from website evidence to an approved change, a publication receipt, and a measurement window.
          </p>
          <h3>Start with one governed view of the website</h3>
          <p data-reading-text>
            A useful growth map connects every URL with its role, target topic, search demand, technical findings, competitive context, and current action. This prevents a keyword list from becoming a detached spreadsheet and keeps every recommendation tied to a page or a deliberate new-page decision.
          </p>
          <h3>Turn evidence into decisions before generating content</h3>
          <p data-reading-text>
            Topic clusters, keyword relationships, internal links, and competitor observations should be reviewed as evidence. Once ownership and intent are confirmed, the system can create a brief, an English draft, metadata, or a technical ticket without losing the original rationale.
          </p>
          <h3>Keep approval, change, and measurement in the same chain</h3>
          <p data-reading-text>
            A draft is not a result, and a publish click is not proof of impact. The workflow should record approval, preserve a change receipt, and open a fixed observation window before presenting before-and-after evidence.
          </p>
          <div class="draft-cta" data-reading-text>
            CTA draft: Review your website, keyword universe, and execution queue in one accountable growth workspace.
          </div>
        </article>
      `,
      "content-brief": `
        <article
          class="deliverable-document"
          data-deliverable-body
          data-deliverable-type="content-brief"
          data-deliverable-status="pending-review"
        >
          <div class="deliverable-document__status">Content Brief · 待审核</div>
          <h2>Unified SEO and GEO workflow: editorial brief</h2>
          <dl class="brief-grid">
            <div><dt>Primary reader</dt><dd>B2B growth leaders coordinating content, SEO, product marketing, and engineering.</dd></div>
            <div><dt>Search intent</dt><dd>Commercial investigation: how to operationalize SEO and GEO work from audit through measurement.</dd></div>
            <div><dt>Core promise</dt><dd>Show how governed evidence becomes a reviewable artifact, a recorded change, and an honest result window.</dd></div>
            <div><dt>Required sections</dt><dd>Website inventory; keyword and topic governance; competitor evidence; deliverable review; publication receipt; before/after boundaries.</dd></div>
            <div><dt>Proof required</dt><dd>Project-specific URL evidence, approved keyword sources, named references, technical recheck, and fixed GSC/GA4 windows.</dd></div>
            <div><dt>Do not claim</dt><dd>No traffic lift, ranking gain, AI citation, backlink, or publication status without corresponding evidence.</dd></div>
          </dl>
        </article>
      `,
      metadata: `
        <article
          class="deliverable-document"
          data-deliverable-body
          data-deliverable-type="metadata"
          data-deliverable-status="pending-review"
        >
          <div class="deliverable-document__status">Metadata · 待审核</div>
          <h2>搜索与分享信息草案</h2>
          <dl class="metadata-grid">
            <div><dt>SEO title</dt><dd>Unified SEO &amp; GEO Workflow: From Audit to Measurable Action</dd></div>
            <div><dt>Meta description</dt><dd>Connect website audits, keyword and competitor research, English content, technical fixes, approvals, receipts, and honest result windows.</dd></div>
            <div><dt>Suggested slug</dt><dd>/blog/unified-seo-geo-workflow/</dd></div>
            <div><dt>Open Graph title</dt><dd>Turn SEO and GEO evidence into accountable growth work</dd></div>
            <div><dt>Structured data</dt><dd>Article and BreadcrumbList candidates; validate authorship, dates, and page hierarchy before release.</dd></div>
            <div><dt>Review note</dt><dd>Final title, canonical URL, author, publication date, and schema values remain pending.</dd></div>
          </dl>
        </article>
      `,
      "technical-ticket-code-patch": `
        <article
          class="deliverable-document"
          data-deliverable-body
          data-deliverable-type="technical-ticket-code-patch"
          data-deliverable-status="pending-action"
        >
          <div class="deliverable-document__status">Technical Ticket / Code Patch · 待处理</div>
          <h2>Preserve source evidence from opportunity to publication receipt</h2>
          <section class="ticket-section">
            <h3>Problem</h3>
            <p data-reading-text>Content and technical artifacts can be reviewed without a durable link to the URL, finding, keyword decision, and source reference that justified the work.</p>
          </section>
          <section class="ticket-section">
            <h3>Proposed change</h3>
            <pre><code>Action → Artifact → Approval
       → Publication / Change Receipt
       → Measurement Window

Every transition keeps the originating URL,
keyword, topic, finding, and source reference.</code></pre>
          </section>
          <section class="ticket-section">
            <h3>Acceptance checks</h3>
            <ul>
              <li data-reading-text>Opening a task from Growth Map retains its page and evidence context.</li>
              <li data-reading-text>Approval cannot imply publication; publication requires an independent receipt.</li>
              <li data-reading-text>Results remain unavailable until the receipt and fixed observation window exist.</li>
              <li data-reading-text>GitHub automation remains disabled until repository scope and approval policy are confirmed.</li>
            </ul>
          </section>
        </article>
      `,
    };
    return (bodies[deliverableId] ?? bodies["english-blog"]).replace(
      "</article>",
      `${renderDeliveryChecks()}</article>`,
    );
  }

  function renderNativeExecution(module, section, selectedCapability) {
    const activeAction = renderSectionPrimaryAction(section);
    return `
      <section
        class="execution-workspace"
        data-execution-workspace
        id="surface-panel-${escapeHtml(section.id)}"
        role="tabpanel"
        aria-labelledby="surface-tab-${escapeHtml(section.id)}"
      >
        <aside class="product-panel work-queue">
          <div class="panel-head">
            <span class="panel-head__eyebrow">WORK QUEUE</span>
            <h2>当前交付物</h2>
            <p>这里展示正文与真实业务状态，不把草稿、待审核或待处理内容误写成正式上线结果。</p>
          </div>
          ${
            activeAction
              ? `<div class="workspace-inline-action">${activeAction}</div>`
              : ""
          }
          <div class="deliverable-tabs" role="tablist" aria-label="交付物类型">
            ${[
              ["english-blog", "English Blog"],
              ["content-brief", "Content Brief"],
              ["metadata", "Metadata"],
              ["technical-ticket-code-patch", "Technical Ticket / Code Patch"],
            ]
              .map(
                ([id, label]) => `
                  <button
                    type="button"
                    role="tab"
                    data-action="select-deliverable"
                    data-deliverable-select="${id}"
                    aria-selected="${state.deliverable === id ? "true" : "false"}"
                    aria-controls="deliverable-canvas"
                  >
                    <span>${escapeHtml(label)}</span>
                    <small>${
                      id === "technical-ticket-code-patch"
                        ? "待处理"
                        : "待审核"
                    }</small>
                  </button>
                `,
              )
              .join("")}
          </div>
        </aside>
        <section class="product-panel deliverable-canvas" id="deliverable-canvas">
          ${renderDeliverableBody(state.deliverable)}
        </section>
        <div class="native-function-workspace execution-workspace__workflow">
          ${renderNativeEntryList(module, selectedCapability, section)}
          ${renderNativeDetail(selectedCapability)}
        </div>
      </section>
      ${renderNativeSectionActions(module, section).replace(activeAction, "")}
    `;
  }

  function resultViewCopy(sectionId) {
    const views = {
      "technical-recheck": {
        title: "技术复查等待执行",
        reason:
          "尚未选择带变更回执的页面。执行 canonical、Schema、Metadata 或 Code Patch 后，系统会以独立抓取结果对照变更前状态。",
        before: "需要：变更前页面快照与检查结果",
        after: "需要：变更后独立抓取与验证时间",
      },
      "gsc-ga4-windows": {
        title: "GSC / GA4 观测窗口尚未建立",
        reason:
          "需要先确认数据授权、时区、Conversion 定义、发布回执和固定窗口。缺数时显示缺数原因，不补零。",
        before: "需要：基线窗口、来源、样本与新鲜度",
        after: "需要：同口径观察窗口与完整性说明",
      },
      "keyword-outcomes": {
        title: "目标词还没有可比较的连续观测",
        reason:
          "排名历史必须保留市场、设备、Provider 与采集时间。只有关联真实变更回执时，才会标出改动点。",
        before: "需要：目标词原始 Rank Series",
        after: "需要：同口径 Rank Series 与变更回执",
      },
      "change-timeline": {
        title: "变更与结果时间线为空",
        reason:
          "审核、发布、技术变更、复查与观测需要独立记录；审批不等于发布，发布也不等于效果。",
        before: "需要：批准的交付物与变更前证据",
        after: "需要：不可变回执、复查和观测记录",
      },
      "geo-observations": {
        title: "GEO Citation 证据当前不可用",
        reason:
          "只有外部服务授权、Query、回答快照、引用位置与失败状态齐备时才显示引用观测；结构差异仅用于分析，不声称因果。",
        before: "需要：平台、Query 与基线回答快照",
        after: "需要：同条件回答快照与引用位置",
      },
    };
    return views[sectionId] ?? views["technical-recheck"];
  }

  function renderNativeResults(module, section, selectedCapability) {
    const copy = resultViewCopy(section.id);
    const activeAction = renderSectionPrimaryAction(section);
    return `
      <section
        class="results-workspace"
        id="surface-panel-${escapeHtml(section.id)}"
        role="tabpanel"
        aria-labelledby="surface-tab-${escapeHtml(section.id)}"
        data-results-workspace
      >
        <header class="object-workspace__head">
          <div>
            <p class="panel-head__eyebrow">BEFORE / AFTER</p>
            <h2>${escapeHtml(section.title)}</h2>
            <p data-reading-text>${escapeHtml(section.purpose)}</p>
          </div>
          ${truthBadge(section.truthStatus)}
        </header>
        <div class="comparison-skeleton">
          <article data-before>
            <span>改前证据</span>
            <strong>${escapeHtml(copy.before)}</strong>
          </article>
          <span class="comparison-arrow" aria-hidden="true">→</span>
          <article data-after>
            <span>改后证据</span>
            <strong>${escapeHtml(copy.after)}</strong>
          </article>
        </div>
        <div
          class="honest-empty honest-empty--large"
          data-honest-empty-state
          data-evidence-status="unavailable"
        >
          <strong>${escapeHtml(copy.title)}</strong>
          <p data-reading-text>${escapeHtml(copy.reason)}</p>
          ${activeAction}
        </div>
        <div class="native-function-workspace results-workspace__workflow">
          ${renderNativeEntryList(module, selectedCapability, section)}
          ${renderNativeDetail(selectedCapability)}
        </div>
      </section>
      ${renderNativeSectionActions(module, section).replace(activeAction, "")}
    `;
  }

  function renderNativeModule(module, section, selectedCapability) {
    if (module.id === "overview") {
      return renderNativeOverview(module, section, selectedCapability);
    }
    if (module.id === "growth-map") {
      return renderNativeGrowth(module, section, selectedCapability);
    }
    if (module.id === "execution") {
      return renderNativeExecution(module, section, selectedCapability);
    }
    return renderNativeResults(module, section, selectedCapability);
  }

  function renderProductView() {
    const module = moduleById(state.view) ?? product.modules[0];
    const section = sectionById(module, state.surface) ?? firstSection(module);
    const selectedCapability =
      capabilityByEntryId(state.entryId) ?? firstCapability(module, section);
    const main = document.getElementById("product-content");
    const targetAttribute = state.target
      ? ` data-governed-target="${escapeHtml(state.target)}"`
      : "";
    const headings = {
      overview: "今天先推进什么",
      "growth-map": "从全站证据找到增长机会",
      execution: "直接审核和处理交付物",
      results: "用证据窗口看改前与改后",
    };

    main.setAttribute("data-product-surface", module.id);
    main.innerHTML = `
      <div class="product-workspace"${targetAttribute}>
        <header class="product-heading">
          <div>
            <p class="product-heading__eyebrow">${escapeHtml(
              module.enName ?? module.id,
            )} · ${escapeHtml(module.name)}</p>
            <h1>${escapeHtml(headings[module.id])}</h1>
            <p class="product-heading__promise" data-reading-text>${escapeHtml(
              module.customerGoal,
            )}</p>
          </div>
          <aside class="truth-card">
            <span class="truth-card__label">${escapeHtml(
              truthLabel(module.truthStatus),
            )}</span>
            <p data-reading-text>${escapeHtml(
              customerTruthCopy(module.truthStatus),
            )}</p>
          </aside>
        </header>
        ${renderSurfaceTabs(module, section)}
        <div class="native-module-workspace">
          ${renderNativeModule(module, section, selectedCapability)}
        </div>
        <footer class="product-footer" data-reading-text>
          当前页面只呈现客户可以操作或验证的内容；缺少项目数据、授权、回执或固定观测窗口时，会明确显示不可用原因。
          原始需求审核位于左侧“审核证据”，不会干扰日常工作。
        </footer>
      </div>
    `;

    document.querySelector("[data-breadcrumb-current]").textContent =
      module.name;
  }

  function renderConnectionsDialog() {
    const dialog = document.querySelector("[data-connections-dialog]");
    const body = dialog.querySelector("[data-connections-body]");
    body.innerHTML = `
      <section class="dialog-section">
        <h3>仅显示真实客户连接</h3>
        <p data-reading-text>
          Nevermore 当前客户可见连接只保留 GSC、GA4 与 GitHub。
          关键词 Provider、评论、GEO Citation 和 Backlink 属于内部证据能力，不伪装成客户连接卡。
        </p>
      </section>
      <section class="dialog-section">
        <div class="connection-ledger">
          ${connections()
            .map(
              (connection) => `
                <div
                  class="connection-row"
                  data-connection-id="${escapeHtml(connection.id)}"
                  data-customer-connector="${escapeHtml(connection.name)}"
                  data-readiness="${escapeHtml(connection.truthStatus)}"
                >
                  <strong>${escapeHtml(connection.name)}</strong>
                  <p data-reading-text>${escapeHtml(connection.purpose)}</p>
                  ${truthBadge(connection.truthStatus)}
                  <p data-reading-text>${escapeHtml(connection.readiness)}</p>
                  ${
                    connection.truthStatus !== "current"
                      ? `<p class="unavailable-note" data-reading-text>${escapeHtml(
                          connection.unavailableText,
                        )}</p>`
                      : ""
                  }
                </div>
              `,
            )
            .join("")}
        </div>
      </section>
    `;
  }

  function renderAuditDialog() {
    const dialog = document.querySelector("[data-audit-evidence-dialog]");
    const body = dialog.querySelector("[data-audit-dialog-body]");
    const selected =
      requirementById(state.auditRequirementId) ?? audit.requirements[0];
    body.innerHTML = `
      <section class="dialog-section">
        <h3>原始需求审计与审核证据</h3>
        <p data-reading-text>
          这里保留的是原始需求审计与审核证据。主工作区展示融合后的正式产品；如需追溯设计原因，可在这里查看原始诉求、当前事实、改写后验收与未包含边界。
        </p>
        <div class="audit-index">
          ${audit.requirements
            .map(
              (requirement) => `
                <button
                  type="button"
                  data-action="select-audit-requirement"
                  data-audit-requirement-id="${requirement.id}"
                  aria-current="${
                    selected.id === requirement.id ? "true" : "false"
                  }"
                >
                  <span class="audit-index__number">${String(
                    requirement.id,
                  ).padStart(2, "0")}</span>
                  <span class="audit-index__title">${escapeHtml(
                    requirement.title,
                  )}</span>
                  <span class="audit-index__state">${escapeHtml(
                    audit.decisionLabels?.[requirement.decision] ??
                      requirement.decision,
                  )}</span>
                </button>
              `,
            )
            .join("")}
        </div>
      </section>
      <section class="dialog-section audit-evidence-detail">
        <p class="dialog-head__eyebrow">审核证据 ${String(
          selected.id,
        ).padStart(2, "0")}</p>
        <h3>${escapeHtml(selected.title)}</h3>
        <p data-reading-text>${escapeHtml(selected.rationale)}</p>
      </section>
      <section class="dialog-section">
        <h3>当前事实</h3>
        ${renderList(selected.currentEvidence, "audit-evidence-list")}
      </section>
      <section class="dialog-section">
        <h3>改写后验收</h3>
        ${renderList(selected.rewrittenAcceptance, "audit-evidence-list")}
      </section>
      <section class="dialog-section">
        <h3>实施条件与依赖</h3>
        ${renderList(selected.dependencies, "audit-evidence-list")}
      </section>
      <section class="dialog-section">
        <h3>明确不包含</h3>
        ${renderList(selected.notIncluded, "audit-evidence-list")}
      </section>
    `;
  }

  function dialogIsOpen(dialog) {
    return Boolean(dialog?.open || dialog?.hasAttribute("open"));
  }

  function focusableIn(dialog) {
    return Array.from(
      dialog.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
  }

  function openDialog(dialog) {
    if (!dialog || dialogIsOpen(dialog)) {
      return;
    }
    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }
    const focusFirst = () => focusableIn(dialog)[0]?.focus();
    if (typeof global.requestAnimationFrame === "function") {
      global.requestAnimationFrame(focusFirst);
    } else {
      focusFirst();
    }
  }

  function closeDialogElement(dialog, restoreFocus = false) {
    if (!dialog || !dialogIsOpen(dialog)) {
      return;
    }
    if (typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
    if (restoreFocus && dialogInvoker?.focus) {
      dialogInvoker.focus();
      dialogInvoker = null;
    }
  }

  function syncDialogs() {
    const connectionsDialog = document.querySelector(
      "[data-connections-dialog]",
    );
    const auditDialog = document.querySelector(
      "[data-audit-evidence-dialog]",
    );

    if (state.drawer === "connections") {
      closeDialogElement(auditDialog);
      renderConnectionsDialog();
      openDialog(connectionsDialog);
      return;
    }
    if (state.drawer === "audit") {
      closeDialogElement(connectionsDialog);
      renderAuditDialog();
      openDialog(auditDialog);
      return;
    }

    const hadOpenDialog =
      dialogIsOpen(connectionsDialog) || dialogIsOpen(auditDialog);
    closeDialogElement(connectionsDialog);
    closeDialogElement(auditDialog);
    if (hadOpenDialog && dialogInvoker?.focus) {
      dialogInvoker.focus();
      dialogInvoker = null;
    }
  }

  function render() {
    app.dataset.activeView = state.view;
    if (state.target) {
      app.dataset.activeDestination = state.target;
    } else {
      delete app.dataset.activeDestination;
    }
    document
      .querySelectorAll("[data-product-view]")
      .forEach((button) => {
        if (button.dataset.productView === state.view) {
          button.setAttribute("aria-current", "page");
        } else {
          button.removeAttribute("aria-current");
        }
      });
    renderProductView();
    syncDialogs();
    app.dataset.ready = "true";
  }

  function handleProductAction(target) {
    const encodedDestination = text(
      target.dataset.governedDestination,
      "",
    );
    const [kind = "", ...targetParts] = encodedDestination.split(":");
    const destinationTarget = targetParts.join(":");
    const destination = { kind, target: destinationTarget };
    const route = findDestinationRoute(destination);
    const entryId = text(target.dataset.entryId ?? state.entryId, "");
    const capability = capabilityByEntryId(entryId);

    if (route.drawer === "audit") {
      dialogInvoker = target;
      commitState({
        drawer: "audit",
        auditRequirementId:
          Number(target.dataset.auditRequirement) ||
          capability?.requirementId ||
          state.auditRequirementId,
        target: encodedDestination,
      });
      return;
    }
    if (route.drawer === "connections") {
      dialogInvoker = target;
      commitState({ drawer: "connections", target: encodedDestination });
      return;
    }

    const patch = {
      ...route,
      entryId,
      target: encodedDestination,
      drawer: "",
    };
    if (route.view && route.surface) {
      const routedModule = moduleById(route.view);
      const routedSection = sectionById(routedModule, route.surface);
      const matchingCapability = capabilitiesForSection(
        routedModule,
        routedSection,
      ).find(
        (item) => item.requirementId === capability?.requirementId,
      );
      patch.entryId = matchingCapability
        ? nativeEntryId(matchingCapability)
        : nativeEntryId(firstCapability(routedModule, routedSection));
    }
    commitState(patch);
  }

  function handleClick(event) {
    const dialog = event.target.closest("dialog");
    if (dialog && event.target === dialog) {
      commitState({ drawer: "" }, { replace: true });
      return;
    }

    const target = event.target.closest("[data-action]");
    if (!target || !app.contains(target)) {
      return;
    }

    const action = target.dataset.action;
    if (action === "set-product-view") {
      const module = moduleById(target.dataset.productView);
      const section = firstSection(module);
      commitState({
        view: module.id,
        surface: section?.id ?? "",
        entryId: nativeEntryId(firstCapability(module, section)),
        target: "",
        drawer: "",
      });
      return;
    }
    if (action === "set-surface") {
      const module = moduleById(state.view);
      const section = sectionById(module, target.dataset.sectionId);
      commitState({
        surface: section.id,
        entryId: nativeEntryId(firstCapability(module, section)),
        target: "",
        drawer: "",
      });
      return;
    }
    if (action === "select-native-entry") {
      commitState({
        entryId: text(target.dataset.entryId, ""),
        target: "",
        drawer: "",
      });
      return;
    }
    if (action === "select-deliverable") {
      commitState({
        deliverable: text(target.dataset.deliverableSelect, DELIVERABLE_IDS[0]),
        target: "",
        drawer: "",
      });
      return;
    }
    if (action === "run-product-action") {
      handleProductAction(target);
      return;
    }
    if (action === "open-connections") {
      dialogInvoker = target;
      commitState({
        drawer: "connections",
        target: target.dataset.governedDestination,
      });
      return;
    }
    if (action === "open-audit-evidence") {
      const capability = capabilityByEntryId(state.entryId);
      dialogInvoker = target;
      commitState({
        drawer: "audit",
        auditRequirementId:
          Number(target.dataset.auditRequirement) ||
          capability?.requirementId ||
          state.auditRequirementId,
        target: target.dataset.governedDestination,
      });
      return;
    }
    if (action === "select-audit-requirement") {
      commitState({
        drawer: "audit",
        auditRequirementId: Number(target.dataset.auditRequirementId),
      });
      return;
    }
    if (action === "close-dialog") {
      commitState({ drawer: "" }, { replace: true });
    }
  }

  function handleKeydown(event) {
    const surfaceTab = event.target.closest?.(
      '[role="tab"][data-section-id]',
    );
    if (
      surfaceTab &&
      ["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)
    ) {
      const tabs = Array.from(
        surfaceTab
          .closest('[role="tablist"]')
          ?.querySelectorAll('[role="tab"][data-section-id]') ?? [],
      );
      const currentIndex = tabs.indexOf(surfaceTab);
      if (currentIndex >= 0 && tabs.length > 0) {
        event.preventDefault();
        let nextIndex = currentIndex;
        if (event.key === "ArrowRight") {
          nextIndex = (currentIndex + 1) % tabs.length;
        } else if (event.key === "ArrowLeft") {
          nextIndex = (currentIndex - 1 + tabs.length) % tabs.length;
        } else if (event.key === "Home") {
          nextIndex = 0;
        } else if (event.key === "End") {
          nextIndex = tabs.length - 1;
        }
        const nextSectionId = tabs[nextIndex].dataset.sectionId;
        const module = moduleById(state.view);
        const nextSection = sectionById(module, nextSectionId);
        commitState({
          surface: nextSectionId,
          entryId: nativeEntryId(firstCapability(module, nextSection)),
          target: "",
          drawer: "",
        });
        global.requestAnimationFrame?.(() => {
          document
            .querySelector(
              `[role="tab"][data-section-id="${nextSectionId}"]`,
            )
            ?.focus();
        });
        return;
      }
    }

    const openDialogElement = Array.from(
      document.querySelectorAll("dialog"),
    ).find(dialogIsOpen);
    if (!openDialogElement) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      commitState({ drawer: "" }, { replace: true });
      return;
    }
    if (event.key !== "Tab") {
      return;
    }
    const focusable = focusableIn(openDialogElement);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (
      event.shiftKey &&
      (document.activeElement === first || event.target === first)
    ) {
      event.preventDefault();
      last.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last || event.target === last)
    ) {
      event.preventDefault();
      first.focus();
    }
  }

  function boot() {
    app = document.getElementById("app");
    audit = global.NevermoreKeywordAudit;
    product = audit?.integratedProduct;

    if (
      !app ||
      !audit ||
      !product ||
      !Array.isArray(product.modules) ||
      product.modules.length !== 4 ||
      !Array.isArray(product.capabilities)
    ) {
      if (app) {
        app.innerHTML = `
          <main class="boot-error" role="alert">
            <h1>产品数据不可用</h1>
            <p data-reading-text>
              无法读取 Nevermore 工作台数据。请重新生成正式 Artifact，
              或检查当前项目的数据文件是否完整。
            </p>
          </main>
        `;
      }
      return;
    }

    renderShell();
    state = parseHash();
    const canonicalHash = stateHash(state);
    if (global.location.hash !== canonicalHash) {
      global.history.replaceState(null, "", canonicalHash);
    }
    app.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKeydown, true);
    global.addEventListener("hashchange", () => {
      state = parseHash();
      render();
    });
    render();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot, { once: true });
  } else {
    boot();
  }
})(window);
