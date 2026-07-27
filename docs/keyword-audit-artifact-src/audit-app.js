(function startNevermoreKeywordAudit(global) {
  "use strict";

  const VIEW_IDS = ["requirements", "modules", "stages", "acceptance"];
  const VIEW_LABELS = {
    requirements: "需求审核",
    modules: "模块影响",
    stages: "分阶段落地",
    acceptance: "验收证据",
  };
  const DECISION_IDS = ["all", "adopt", "rewrite", "defer"];
  const DECISION_LABELS = {
    all: "全部结论",
    adopt: "直接纳入",
    rewrite: "改写后纳入",
    defer: "后置",
  };
  const TRUTH_LABELS = {
    current: "当前已存在",
    partial: "部分存在",
    "not-implemented": "尚未实现",
    "external-dependent": "依赖外部接入",
  };
  const FLAG_STATUS_LABELS = {
    complete: "已完成",
    completed: "已完成",
    pending: "计划中 · 未完成",
    planned: "计划中 · 未完成",
    "not-started": "计划中 · 未完成",
    incomplete: "计划中 · 未完成",
  };
  const DEFAULT_STATE = {
    view: "requirements",
    requirementId: 1,
    decision: "all",
    module: "all",
    stage: "all",
  };

  let audit;
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

  function itemText(item) {
    if (typeof item === "string" || typeof item === "number") {
      return text(item);
    }
    if (item && typeof item === "object") {
      return text(
        item.label ??
          item.name ??
          item.title ??
          item.description ??
          item.deliverable ??
          item.evidenceNeeded,
      );
    }
    return "未提供";
  }

  function renderList(items, className = "review-list") {
    const normalized = list(items);
    if (normalized.length === 0) {
      return '<p data-reading-text>当前没有额外条目。</p>';
    }
    return `<ul class="${escapeHtml(className)}">${normalized
      .map((item) => `<li data-reading-text>${escapeHtml(itemText(item))}</li>`)
      .join("")}</ul>`;
  }

  function getModule(moduleId) {
    return audit.modules.find((module) => module.id === moduleId) ?? null;
  }

  function getStage(stageId) {
    return audit.stages.find((stage) => stage.id === stageId) ?? null;
  }

  function getRequirement(requirementId) {
    return (
      audit.requirements.find(
        (requirement) => requirement.id === Number(requirementId),
      ) ?? audit.requirements[0]
    );
  }

  function requirementMatches(requirement, candidateState) {
    return (
      (candidateState.decision === "all" ||
        requirement.decision === candidateState.decision) &&
      (candidateState.module === "all" ||
        list(requirement.modules).includes(candidateState.module)) &&
      (candidateState.stage === "all" ||
        list(requirement.stage).includes(candidateState.stage))
    );
  }

  function filteredRequirements(candidateState = state) {
    return audit.requirements.filter((requirement) =>
      requirementMatches(requirement, candidateState),
    );
  }

  function normalizeState(candidate) {
    const moduleIds = new Set(audit.modules.map((module) => module.id));
    const stageIds = new Set(audit.stages.map((stage) => stage.id));
    const normalized = {
      view: VIEW_IDS.includes(candidate.view)
        ? candidate.view
        : DEFAULT_STATE.view,
      requirementId: audit.requirements.some(
        (requirement) => requirement.id === Number(candidate.requirementId),
      )
        ? Number(candidate.requirementId)
        : audit.requirements[0].id,
      decision: DECISION_IDS.includes(candidate.decision)
        ? candidate.decision
        : "all",
      module:
        candidate.module === "all" || moduleIds.has(candidate.module)
          ? candidate.module
          : "all",
      stage:
        candidate.stage === "all" || stageIds.has(candidate.stage)
          ? candidate.stage
          : "all",
    };

    const visible = filteredRequirements(normalized);
    if (
      visible.length > 0 &&
      !visible.some(
        (requirement) => requirement.id === normalized.requirementId,
      )
    ) {
      normalized.requirementId = visible[0].id;
    }
    return normalized;
  }

  function parseHash() {
    const rawHash = global.location.hash.replace(/^#\/?/, "");
    const [rawView = "", rawQuery = ""] = rawHash.split("?");
    const params = new URLSearchParams(rawQuery);
    return normalizeState({
      view: rawView || DEFAULT_STATE.view,
      requirementId: Number(params.get("item") ?? DEFAULT_STATE.requirementId),
      decision: params.get("decision") ?? "all",
      module: params.get("module") ?? "all",
      stage: params.get("stage") ?? "all",
    });
  }

  function stateHash(candidateState) {
    const params = new URLSearchParams({
      item: String(candidateState.requirementId),
      decision: candidateState.decision,
      module: candidateState.module,
      stage: candidateState.stage,
    });
    return `#/${candidateState.view}?${params.toString()}`;
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
  }

  function decisionStamp(decision) {
    return `<span class="stamp stamp--${escapeHtml(decision)}">${escapeHtml(
      audit.decisionLabels?.[decision] ?? DECISION_LABELS[decision] ?? decision,
    )}</span>`;
  }

  function truthStamp(truth) {
    return `<span class="stamp stamp--truth-${escapeHtml(truth)}">${escapeHtml(
      audit.truthLabels?.[truth] ?? TRUTH_LABELS[truth] ?? truth,
    )}</span>`;
  }

  function buildShell() {
    const decisionCounts = {
      adopt: audit.requirements.filter((item) => item.decision === "adopt")
        .length,
      rewrite: audit.requirements.filter((item) => item.decision === "rewrite")
        .length,
      defer: audit.requirements.filter((item) => item.decision === "defer")
        .length,
    };

    document.title = "Nevermore · 关键词增长治理需求审计";
    document.documentElement.lang = "zh-CN";

    app.innerHTML = `
      <div class="audit-shell">
        <header class="audit-header" aria-labelledby="audit-title">
          <div class="masthead">
            <div class="masthead__identity">
              <p class="eyebrow">Nevermore · Formal product audit</p>
              <h1 id="audit-title">${escapeHtml(audit.title)}</h1>
              <p class="masthead__subtitle" data-reading-text>${escapeHtml(
                audit.subtitle,
              )}</p>
            </div>
            <div class="audit-seal" aria-label="正式需求审核，版本 ${escapeHtml(
              audit.version,
            )}">
              <strong>正式审核</strong>
              <span>VERSION ${escapeHtml(audit.version)}</span>
            </div>
          </div>
          <div class="scope-declaration">
            <div class="scope-declaration__copy" data-reading-text>
              <strong>范围声明：</strong>${escapeHtml(audit.productionNotice)}
              <br>${escapeHtml(audit.scopeNotice)}
            </div>
            <div class="scope-declaration__meta">
              <span>审核日期</span>
              <b>${escapeHtml(audit.reviewedAt)}</b>
              <span>客户可见连接：${escapeHtml(
                audit.customerVisibleConnectors.join(" · "),
              )}</span>
            </div>
          </div>
          <div class="decision-register" aria-label="审核结论">
            ${["adopt", "rewrite", "defer"]
              .map(
                (decision, index) => `
                  <button
                    class="decision-register__item"
                    type="button"
                    data-action="set-decision"
                    data-value="${decision}"
                    aria-pressed="false"
                  >
                    <span class="decision-register__mark" aria-hidden="true">0${
                      index + 1
                    }</span>
                    <span>
                      <span class="decision-register__label">${escapeHtml(
                        audit.decisionLabels?.[decision] ??
                          DECISION_LABELS[decision],
                      )}</span>
                      <span class="decision-register__hint">${
                        decision === "adopt"
                          ? "可沿现有产品链路建设"
                          : decision === "rewrite"
                            ? "方向成立，需修正边界"
                            : "保留契约，退出近期范围"
                      }</span>
                    </span>
                    <span class="decision-register__count">${decisionCounts[decision]}</span>
                  </button>
                `,
              )
              .join("")}
          </div>
        </header>

        <nav class="view-tabs" aria-label="审计视图">
          ${VIEW_IDS.map(
            (view, index) => `
              <button
                type="button"
                data-action="set-view"
                data-view="${view}"
              >
                <span class="view-tabs__index" aria-hidden="true">0${
                  index + 1
                }</span>${VIEW_LABELS[view]}
              </button>
            `,
          ).join("")}
        </nav>

        <main id="audit-content" class="audit-workspace">
          <aside
            id="requirement-register"
            class="audit-panel register-panel"
            aria-label="需求清单"
            tabindex="0"
          ></aside>
          <article
            id="review-detail"
            class="audit-panel review-sheet"
            aria-live="polite"
          ></article>
          <aside
            id="impact-rail"
            class="audit-panel impact-panel"
            aria-label="影响与证据"
            tabindex="0"
          ></aside>
        </main>

        <footer class="audit-footer">
          <p data-reading-text>
            <strong>真相边界：</strong>本审计 Artifact 证明 13 条需求已经完成产品审核和实施分层，
            不替代数据库、Contract、Service、Mutation、UI、测试与真实 Provider 的生产证据。
          </p>
          <span class="audit-footer__version">Nevermore Audit · ${escapeHtml(
            audit.version,
          )}</span>
        </footer>
      </div>

      <dialog
        class="evidence-dialog"
        data-evidence-dialog
        aria-modal="true"
        aria-labelledby="evidence-dialog-title"
      >
        <div class="dialog-head">
          <div>
            <p class="eyebrow">Evidence ledger</p>
            <h2 id="evidence-dialog-title">结构化验收证据</h2>
          </div>
          <button
            class="dialog-close"
            type="button"
            data-action="close-dialog"
            aria-label="关闭证据抽屉"
          >×</button>
        </div>
        <div
          class="dialog-body"
          data-dialog-body
          role="region"
          aria-label="结构化验收证据内容"
          tabindex="0"
        ></div>
        <div class="dialog-foot">
          <button
            class="button button--secondary"
            type="button"
            data-action="go-to-acceptance"
          >查看对应验收层</button>
          <button class="button" type="button" data-action="close-dialog">
            返回审核
          </button>
        </div>
      </dialog>
    `;

    const dialog = getDialog();
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeDialog();
    });
  }

  function renderFilters() {
    return `
      <div class="filter-stack" aria-label="需求筛选">
        <div class="filter-field">
          <label for="decision-filter">结论</label>
          <select
            id="decision-filter"
            data-filter="decision"
            data-decision-filter
          >
            ${DECISION_IDS.map(
              (decision) => `
                <option value="${decision}" ${
                  state.decision === decision ? "selected" : ""
                }>${escapeHtml(
                  audit.decisionLabels?.[decision] ??
                    DECISION_LABELS[decision],
                )}</option>
              `,
            ).join("")}
          </select>
        </div>
        <div class="filter-field">
          <label for="module-filter">模块</label>
          <select id="module-filter" data-filter="module" data-module-filter>
            <option value="all" ${state.module === "all" ? "selected" : ""}>
              全部模块
            </option>
            ${audit.modules
              .map(
                (module) => `
                  <option value="${escapeHtml(module.id)}" ${
                    state.module === module.id ? "selected" : ""
                  }>${escapeHtml(module.name)}</option>
                `,
              )
              .join("")}
          </select>
        </div>
        <div class="filter-field">
          <label for="stage-filter">阶段</label>
          <select id="stage-filter" data-filter="stage" data-stage-filter>
            <option value="all" ${state.stage === "all" ? "selected" : ""}>
              全部阶段
            </option>
            ${audit.stages
              .map(
                (stage) => `
                  <option value="${escapeHtml(stage.id)}" ${
                    state.stage === stage.id ? "selected" : ""
                  }>${escapeHtml(stage.name)}</option>
                `,
              )
              .join("")}
          </select>
        </div>
        <button class="filter-clear" type="button" data-action="clear-filters">
          清除筛选
        </button>
      </div>
    `;
  }

  function renderRequirementRows(requirements) {
    if (requirements.length === 0) {
      return `
        <div class="empty-register">
          <p data-reading-text>当前组合没有匹配需求。请清除一个筛选条件。</p>
          <button class="button button--secondary" type="button" data-action="clear-filters">
            恢复全部需求
          </button>
        </div>
      `;
    }

    return `
      <ol class="requirement-list">
        ${requirements
          .map(
            (requirement) => `
              <li>
                <button
                  class="requirement-row"
                  type="button"
                  data-action="select-requirement"
                  data-requirement-id="${requirement.id}"
                  data-decision="${escapeHtml(requirement.decision)}"
                  data-modules="${escapeHtml(list(requirement.modules).join(" "))}"
                  data-stages="${escapeHtml(list(requirement.stage).join(" "))}"
                  aria-current="${
                    state.requirementId === requirement.id ? "true" : "false"
                  }"
                >
                  <span class="requirement-row__number">${String(
                    requirement.id,
                  ).padStart(2, "0")}</span>
                  <span>
                    <span class="requirement-row__title">${escapeHtml(
                      requirement.title,
                    )}</span>
                    <span class="requirement-row__meta">
                      <span>${escapeHtml(
                        audit.decisionLabels?.[requirement.decision] ??
                          DECISION_LABELS[requirement.decision],
                      )}</span>
                      <span>${escapeHtml(
                        requirement.auditedPriority ?? requirement.sourcePriority,
                      )}</span>
                    </span>
                  </span>
                </button>
              </li>
            `,
          )
          .join("")}
      </ol>
    `;
  }

  function renderRegister() {
    const requirements = filteredRequirements();
    const register = document.getElementById("requirement-register");
    register.innerHTML = `
      <div class="panel-heading">
        <p class="eyebrow">Demand register</p>
        <h2>需求清单</h2>
        <p>${requirements.length} / ${audit.requirements.length} 条符合当前筛选</p>
      </div>
      ${renderFilters()}
      ${renderRequirementRows(requirements)}
    `;
  }

  function renderCompletionFlags(requirement) {
    const flags = list(requirement.completionFlags);
    if (flags.length === 0) {
      return "";
    }

    return `
      <div class="completion-flags">
        ${flags
          .map((flag) => {
            const status = text(flag.status, "pending").toLowerCase();
            const statusLabel =
              FLAG_STATUS_LABELS[status] ?? `${status} · 未完成`;
            return `
              <div
                class="completion-flag"
                data-completion-flag="${escapeHtml(flag.id)}"
                data-status="${escapeHtml(status)}"
              >
                <span class="completion-flag__mark" aria-hidden="true">${
                  status === "complete" || status === "completed" ? "✓" : "!"
                }</span>
                <div>
                  <strong>${escapeHtml(flag.label)}</strong>
                  <p data-reading-text>${escapeHtml(statusLabel)} · ${escapeHtml(
                    flag.evidenceNeeded,
                  )}</p>
                </div>
              </div>
            `;
          })
          .join("")}
      </div>
    `;
  }

  function renderRequirementDetail() {
    const requirement = getRequirement(state.requirementId);
    const article = document.getElementById("review-detail");
    article.className = "audit-panel review-sheet";
    article.setAttribute("data-requirement-detail", "");
    article.innerHTML = `
      <div class="review-sheet__inner">
        <div class="review-sheet__topline">
          <span class="review-sheet__id">REVIEW ${String(
            requirement.id,
          ).padStart(2, "0")} / 13 · ${escapeHtml(
            requirement.auditedPriority ?? requirement.sourcePriority,
          )}</span>
          <div class="relation-chips">
            ${decisionStamp(requirement.decision)}
            ${truthStamp(requirement.currentTruth)}
          </div>
        </div>

        <h2 id="detail-title">${escapeHtml(requirement.title)}</h2>
        <p class="review-sheet__lede" data-reading-text>${escapeHtml(
          requirement.targetTruth,
        )}</p>

        <section class="review-section" aria-labelledby="source-statement-label">
          <h3 class="review-section__label" id="source-statement-label">原始诉求</h3>
          <div class="review-section__body">
            <p data-reading-text>${escapeHtml(requirement.sourceStatement)}</p>
            <div class="relation-chips">
              <span class="relation-chip">${escapeHtml(
                requirement.sourceLocation,
              )}</span>
              <span class="relation-chip">原优先级 ${escapeHtml(
                requirement.sourcePriority,
              )}</span>
              <span class="relation-chip">审核优先级 ${escapeHtml(
                requirement.auditedPriority,
              )}</span>
            </div>
          </div>
        </section>

        <section class="review-section" aria-labelledby="current-truth-label">
          <h3 class="review-section__label" id="current-truth-label">当前事实</h3>
          <div class="review-section__body">
            ${renderList(requirement.currentEvidence)}
          </div>
        </section>

        <section class="review-section" aria-labelledby="decision-label">
          <h3 class="review-section__label" id="decision-label">审核判断</h3>
          <div class="review-section__body">
            <div class="review-note">
              <strong>${escapeHtml(
                audit.decisionLabels?.[requirement.decision] ??
                  DECISION_LABELS[requirement.decision],
              )}</strong>
              <span data-reading-text>${escapeHtml(requirement.rationale)}</span>
            </div>
          </div>
        </section>

        <section class="review-section" aria-labelledby="acceptance-label">
          <h3 class="review-section__label" id="acceptance-label">改写后验收</h3>
          <div class="review-section__body">
            ${renderList(requirement.rewrittenAcceptance)}
          </div>
        </section>

        ${
          list(requirement.completionFlags).length > 0
            ? `
              <section class="review-section" aria-labelledby="completion-label">
                <h3 class="review-section__label" id="completion-label">独立完成标记</h3>
                <div class="review-section__body">
                  ${renderCompletionFlags(requirement)}
                </div>
              </section>
            `
            : ""
        }

        <section class="review-section" aria-labelledby="boundary-label">
          <h3 class="review-section__label" id="boundary-label">明确不包含</h3>
          <div class="review-section__body">
            ${renderList(requirement.notIncluded)}
          </div>
        </section>

        <div class="sheet-actions">
          <button
            class="button"
            type="button"
            data-action="open-evidence"
            data-evidence-requirement="${requirement.id}"
          >查看结构化验收证据</button>
          <button
            class="button button--secondary"
            type="button"
            data-action="select-stage"
            data-stage-id="${escapeHtml(list(requirement.stage)[0])}"
          >查看落地阶段</button>
        </div>
      </div>
    `;
  }

  function renderModulesView() {
    const selectedModule =
      state.module === "all" ? null : getModule(state.module);
    const article = document.getElementById("review-detail");
    article.className = "audit-panel module-detail";
    article.removeAttribute("data-requirement-detail");
    article.innerHTML = `
      <div class="editorial-title">
        <p class="eyebrow">Module impact</p>
        <h2>四个客户模块，共用一条增长证据链</h2>
        <p data-reading-text>
          需求不会形成独立 SEO 工具。选择模块可查看客户界面变化、受影响需求和需要补齐的生产证据。
        </p>
      </div>
      <div class="module-index">
        ${audit.modules
          .map(
            (module) => `
              <button
                class="module-card"
                type="button"
                data-action="select-module"
                data-module-id="${escapeHtml(module.id)}"
                aria-pressed="${state.module === module.id ? "true" : "false"}"
              >
                <span class="module-card__head">
                  <span>
                    <span class="eyebrow">${escapeHtml(
                      module.enName ?? module.id,
                    )}</span>
                    <h3>${escapeHtml(module.name)}</h3>
                  </span>
                  <span class="module-card__count">${list(
                    module.requirementIds,
                  ).length} 条需求</span>
                </span>
                <p class="module-copy" data-reading-text>${escapeHtml(
                  module.purpose,
                )}</p>
              </button>
            `,
          )
          .join("")}
      </div>
      ${
        selectedModule
          ? `
            <div class="editorial-body">
              <section class="editorial-section">
                <h3>${escapeHtml(selectedModule.name)}的客户界面变化</h3>
                ${renderList(selectedModule.customerChange)}
              </section>
              <section class="editorial-section">
                <h3>关联需求</h3>
                ${renderLinkedRequirements(selectedModule.requirementIds)}
              </section>
            </div>
          `
          : ""
      }
    `;
  }

  function renderStagesView() {
    const selectedStage = getStage(state.stage) ?? audit.stages[0];
    const article = document.getElementById("review-detail");
    article.className = "audit-panel stage-detail";
    article.removeAttribute("data-requirement-detail");
    article.innerHTML = `
      <div class="editorial-title">
        <p class="eyebrow">Delivery sequence</p>
        <h2>先建权威，再建地图，最后接外部证据</h2>
        <p data-reading-text>
          三个 Stage 各自拥有明确范围、依赖、退出门槛和不包含项；任何静态界面都不能代替阶段验收。
        </p>
      </div>
      <div class="stage-index">
        ${audit.stages
          .map(
            (stage, index) => `
              <button
                class="stage-card"
                type="button"
                data-action="select-stage"
                data-stage-id="${escapeHtml(stage.id)}"
                aria-pressed="${
                  selectedStage.id === stage.id ? "true" : "false"
                }"
              >
                <span class="stage-card__head">
                  <span>
                    <span class="eyebrow">Stage 0${index + 1}</span>
                    <h3>${escapeHtml(stage.name)}</h3>
                  </span>
                  <span class="stage-card__count">${list(
                    stage.requirementIds,
                  ).length} 条需求</span>
                </span>
                <p class="stage-copy" data-reading-text>${escapeHtml(
                  stage.goal,
                )}</p>
              </button>
            `,
          )
          .join("")}
      </div>
      <div class="editorial-body">
        <div class="scope-grid">
          <section class="scope-block">
            <h3>范围 Scope</h3>
            ${renderList(selectedStage.scope)}
          </section>
          <section class="scope-block">
            <h3>依赖 Dependencies</h3>
            ${renderList(selectedStage.dependencies)}
          </section>
          <section class="scope-block scope-block--excluded">
            <h3>不包含 Exclusions</h3>
            ${renderList(selectedStage.exclusions)}
          </section>
          <section class="scope-block">
            <h3>关联需求</h3>
            ${renderLinkedRequirements(selectedStage.requirementIds)}
          </section>
        </div>
        <section class="editorial-section">
          <div class="gate">
            <h3>退出门槛 Exit Gate</h3>
            ${renderList(selectedStage.exitGate)}
          </div>
        </section>
      </div>
    `;
  }

  function renderAcceptanceView() {
    const article = document.getElementById("review-detail");
    article.className = "audit-panel acceptance-detail";
    article.removeAttribute("data-requirement-detail");
    article.innerHTML = `
      <div class="editorial-title">
        <p class="eyebrow">Acceptance evidence</p>
        <h2>七层证据全部成立，能力才算上线</h2>
        <p data-reading-text>
          每条需求需要覆盖适用的数据、Contract/API、Service、UI、Mutation/Audit、
          测试和真实 Provider 证据；不可用状态必须诚实呈现。
        </p>
      </div>
      <div class="acceptance-index">
        ${audit.acceptanceLayers
          .map(
            (layer, index) => `
              <section
                class="acceptance-layer"
                data-acceptance-layer="${escapeHtml(layer.id)}"
              >
                <div class="acceptance-layer__head">
                  <span>
                    <span class="eyebrow">Evidence 0${index + 1}</span>
                    <h3>${escapeHtml(layer.name)}</h3>
                  </span>
                </div>
                <p class="acceptance-copy" data-reading-text>${escapeHtml(
                  layer.description,
                )}</p>
              </section>
            `,
          )
          .join("")}
      </div>
      <div class="editorial-body">
        <section class="editorial-section">
          <h3>需求验收台账</h3>
          <div
            class="acceptance-ledger"
            role="region"
            aria-label="需求验收证据矩阵"
            tabindex="0"
          >
            <table class="acceptance-matrix">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">需求</th>
                  <th scope="col">阶段</th>
                  <th scope="col">证据条目</th>
                </tr>
              </thead>
              <tbody>
                ${audit.requirements
                  .map(
                    (requirement) => `
                      <tr>
                        <th scope="row">${String(requirement.id).padStart(
                          2,
                          "0",
                        )}</th>
                        <td>
                          <button
                            type="button"
                            data-action="open-evidence"
                            data-evidence-requirement="${requirement.id}"
                          >${escapeHtml(requirement.title)}</button>
                        </td>
                        <td>${escapeHtml(
                          list(requirement.stage)
                            .map(
                              (stageId) =>
                                getStage(stageId)?.name ?? stageId,
                            )
                            .join(" · "),
                        )}</td>
                        <td>
                          <span class="evidence-marker">${list(
                            requirement.completionEvidence,
                          ).length} 项</span>
                        </td>
                      </tr>
                    `,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    `;
  }

  function renderLinkedRequirements(requirementIds) {
    const idSet = new Set(list(requirementIds).map(Number));
    const requirements = audit.requirements.filter((requirement) =>
      idSet.has(requirement.id),
    );
    if (requirements.length === 0) {
      return '<p data-reading-text>当前没有关联需求。</p>';
    }
    return `
      <div class="impact-requirements">
        ${requirements
          .map(
            (requirement) => `
              <button
                class="impact-requirement"
                type="button"
                data-action="select-linked-requirement"
                data-target-requirement-id="${requirement.id}"
              >
                <span class="impact-requirement__number">${String(
                  requirement.id,
                ).padStart(2, "0")}</span>
                <span class="impact-requirement__title">${escapeHtml(
                  requirement.title,
                )}</span>
                <span class="impact-requirement__arrow" aria-hidden="true">→</span>
              </button>
            `,
          )
          .join("")}
      </div>
    `;
  }

  function renderRequirementRail() {
    const requirement = getRequirement(state.requirementId);
    const modules = list(requirement.modules)
      .map(getModule)
      .filter(Boolean);
    const stages = list(requirement.stage).map(getStage).filter(Boolean);
    return `
      <div class="panel-heading">
        <p class="eyebrow">Impact & evidence</p>
        <h2>影响与证据</h2>
        <p>审核对象 ${String(requirement.id).padStart(2, "0")}</p>
      </div>
      <div class="impact-panel__body">
        <section class="rail-section">
          <h3>治理定位</h3>
          <dl class="rail-facts">
            <div><dt>当前状态</dt><dd>${escapeHtml(
              audit.truthLabels?.[requirement.currentTruth] ??
                TRUTH_LABELS[requirement.currentTruth],
            )}</dd></div>
            <div><dt>审核结论</dt><dd>${escapeHtml(
              audit.decisionLabels?.[requirement.decision] ??
                DECISION_LABELS[requirement.decision],
            )}</dd></div>
            <div><dt>优先级</dt><dd>${escapeHtml(
              requirement.auditedPriority,
            )}</dd></div>
            <div><dt>验收证据</dt><dd>${list(
              requirement.completionEvidence,
            ).length} 项</dd></div>
          </dl>
        </section>
        <section class="rail-section">
          <h3>影响模块</h3>
          <ul class="rail-list">
            ${modules
              .map(
                (module) => `
                  <li>
                    <button
                      type="button"
                      data-action="select-module"
                      data-target-module-id="${escapeHtml(module.id)}"
                    >
                      <span class="rail-list__index" aria-hidden="true">↳</span>
                      <span>${escapeHtml(module.name)}<br><small>${escapeHtml(
                        module.purpose,
                      )}</small></span>
                    </button>
                  </li>
                `,
              )
              .join("")}
          </ul>
        </section>
        <section class="rail-section">
          <h3>落地阶段</h3>
          <div class="rail-callout">
            <p data-reading-text>${escapeHtml(
              stages.map((stage) => stage.name).join(" → "),
            )}</p>
          </div>
          <div class="sheet-actions">
            <button
              class="button button--secondary"
              type="button"
              data-action="open-evidence"
              data-evidence-requirement="${requirement.id}"
            >打开证据台账</button>
          </div>
        </section>
      </div>
    `;
  }

  function renderContextRail() {
    const selectedModule = getModule(state.module);
    const selectedStage = getStage(state.stage);
    const visible = filteredRequirements();
    return `
      <div class="panel-heading">
        <p class="eyebrow">Audit context</p>
        <h2>${
          state.view === "modules"
            ? "模块影响摘要"
            : state.view === "stages"
              ? "阶段验收摘要"
              : "证据使用规则"
        }</h2>
      </div>
      <div class="impact-panel__body">
        <section class="rail-section">
          <h3>当前焦点</h3>
          <p data-reading-text>${escapeHtml(
            selectedModule?.purpose ??
              selectedStage?.goal ??
              "七层验收矩阵用于证明生产能力，不用界面存在代替真实写入、测试与 Provider 证据。",
          )}</p>
        </section>
        <section class="rail-section">
          <h3>关联需求</h3>
          <p data-reading-text>当前筛选关联 ${visible.length} / ${
            audit.requirements.length
          } 条需求。</p>
          ${
            visible[0]
              ? `
                <div class="sheet-actions">
                  <button
                    class="button button--secondary"
                    type="button"
                    data-action="select-linked-requirement"
                    data-target-requirement-id="${visible[0].id}"
                  >查看第一条关联审核</button>
                </div>
              `
              : ""
          }
        </section>
        <section class="rail-section">
          <h3>客户连接边界</h3>
          <p data-reading-text>${escapeHtml(
            audit.customerVisibleConnectors.join(" · "),
          )}。内部证据 Provider 只在证据旁披露，不伪装成客户连接卡。</p>
        </section>
      </div>
    `;
  }

  function renderRail() {
    const rail = document.getElementById("impact-rail");
    rail.innerHTML =
      state.view === "requirements"
        ? renderRequirementRail()
        : renderContextRail();
  }

  function render() {
    app.dataset.activeView = state.view;
    document
      .querySelectorAll('[data-action="set-view"][data-view]')
      .forEach((button) => {
        if (button.dataset.view === state.view) {
          button.setAttribute("aria-current", "page");
        } else {
          button.removeAttribute("aria-current");
        }
      });
    document
      .querySelectorAll('[data-action="set-decision"]')
      .forEach((button) =>
        button.setAttribute(
          "aria-pressed",
          String(button.dataset.value === state.decision),
        ),
      );

    renderRegister();

    if (state.view === "requirements") {
      renderRequirementDetail();
    } else if (state.view === "modules") {
      renderModulesView();
    } else if (state.view === "stages") {
      renderStagesView();
    } else {
      renderAcceptanceView();
    }

    renderRail();
    app.dataset.ready = "true";
  }

  function getDialog() {
    return document.querySelector("dialog[data-evidence-dialog]");
  }

  function isDialogOpen(dialog = getDialog()) {
    return Boolean(dialog?.open || dialog?.hasAttribute("open"));
  }

  function dialogFocusable(dialog = getDialog()) {
    return Array.from(
      dialog.querySelectorAll(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    );
  }

  function openEvidence(requirementId, invoker) {
    const requirement = getRequirement(requirementId);
    const dialog = getDialog();
    const body = dialog.querySelector("[data-dialog-body]");
    dialogInvoker = invoker ?? document.activeElement;
    dialog.dataset.requirementId = String(requirement.id);
    dialog.querySelector("#evidence-dialog-title").textContent =
      `${String(requirement.id).padStart(2, "0")} · ${requirement.title}`;
    body.innerHTML = `
      <section class="dialog-section">
        <h3>当前 canonical 证据</h3>
        ${renderList(requirement.currentEvidence)}
      </section>
      <section class="dialog-section">
        <h3>上线所需证据</h3>
        ${renderList(requirement.completionEvidence)}
      </section>
      <section class="dialog-section">
        <h3>依赖</h3>
        ${renderList(requirement.dependencies)}
      </section>
      <section class="dialog-section">
        <h3>不包含边界</h3>
        ${renderList(requirement.notIncluded)}
      </section>
      ${
        list(requirement.completionFlags).length > 0
          ? `
            <section class="dialog-section">
              <h3>独立完成标记</h3>
              ${renderCompletionFlags(requirement)}
            </section>
          `
          : ""
      }
    `;

    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }

    const focusFirst = () => dialogFocusable(dialog)[0]?.focus();
    if (typeof global.requestAnimationFrame === "function") {
      global.requestAnimationFrame(focusFirst);
    } else {
      focusFirst();
    }
  }

  function closeDialog(options = {}) {
    const dialog = getDialog();
    if (!dialog || !isDialogOpen(dialog)) {
      return;
    }
    if (typeof dialog.close === "function") {
      dialog.close();
    } else {
      dialog.removeAttribute("open");
    }
    const invoker = dialogInvoker;
    dialogInvoker = null;
    if (options.restoreFocus !== false && invoker?.focus) {
      invoker.focus();
    }
  }

  function handleClick(event) {
    const dialog = getDialog();
    if (event.target === dialog) {
      closeDialog();
      return;
    }

    const target = event.target.closest("[data-action]");
    if (!target || !app.contains(target)) {
      return;
    }

    const action = target.dataset.action;
    if (action === "set-view") {
      commitState({ view: target.dataset.view });
      return;
    }
    if (action === "set-decision") {
      const decision =
        state.decision === target.dataset.value ? "all" : target.dataset.value;
      commitState({ view: "requirements", decision });
      return;
    }
    if (action === "clear-filters") {
      commitState({ decision: "all", module: "all", stage: "all" });
      return;
    }
    if (action === "select-requirement") {
      commitState({
        view: "requirements",
        requirementId: Number(target.dataset.requirementId),
      });
      return;
    }
    if (action === "select-linked-requirement") {
      const requirementId = Number(target.dataset.targetRequirementId);
      const requirement = getRequirement(requirementId);
      commitState({
        view: "requirements",
        requirementId,
        decision: "all",
        module: "all",
        stage: "all",
      });
      if (requirement && global.innerWidth <= 860) {
        document
          .getElementById("review-detail")
          ?.scrollIntoView({ block: "start" });
      }
      return;
    }
    if (action === "select-module") {
      const moduleId =
        target.dataset.moduleId ?? target.dataset.targetModuleId;
      commitState({ view: "modules", module: moduleId, stage: "all" });
      return;
    }
    if (action === "select-stage") {
      commitState({
        view: "stages",
        stage: target.dataset.stageId,
        module: "all",
      });
      return;
    }
    if (action === "open-evidence") {
      openEvidence(
        Number(
          target.dataset.evidenceRequirement ?? state.requirementId,
        ),
        target,
      );
      return;
    }
    if (action === "close-dialog") {
      closeDialog();
      return;
    }
    if (action === "go-to-acceptance") {
      closeDialog({ restoreFocus: false });
      commitState({ view: "acceptance" });
    }
  }

  function handleChange(event) {
    const control = event.target.closest("select[data-filter]");
    if (!control || !app.contains(control)) {
      return;
    }
    const filter = control.dataset.filter;
    if (!["decision", "module", "stage"].includes(filter)) {
      return;
    }
    commitState({ [filter]: control.value });
  }

  function handleKeydown(event) {
    const dialog = getDialog();
    if (!dialog || !isDialogOpen(dialog)) {
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      closeDialog();
      return;
    }
    if (event.key !== "Tab") {
      return;
    }

    const focusable = dialogFocusable(dialog);
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function boot() {
    app = document.getElementById("app");
    audit = global.NevermoreKeywordAudit;

    if (!app || !audit || !Array.isArray(audit.requirements)) {
      if (app) {
        app.innerHTML = `
          <main class="boot-error" role="alert">
            <h1>审计数据不可用</h1>
            <p>无法读取 Nevermore 关键词需求审计数据，请重新生成正式 Artifact。</p>
          </main>
        `;
      }
      return;
    }

    buildShell();
    state = parseHash();
    const canonicalHash = stateHash(state);
    if (global.location.hash !== canonicalHash) {
      global.history.replaceState(null, "", canonicalHash);
    }
    app.addEventListener("click", handleClick);
    app.addEventListener("change", handleChange);
    document.addEventListener("keydown", handleKeydown);
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
