(() => {
  "use strict";

  const state = {
    creators: [],
    clients: [],
    config: { dropRequiresApproval: true },
    creatorId: null,
    tab: "board",
    cardData: [],
    detail: null,
  };

  const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  // ---------- API ----------

  async function api(path, opts) {
    const res = await fetch(path, {
      ...opts,
      headers: { "content-type": "application/json", ...(opts && opts.headers) },
    });
    let data = null;
    try {
      data = await res.json();
    } catch (_) {
      // no body
    }
    if (!res.ok) {
      throw new Error((data && data.error) || `Request failed (${res.status})`);
    }
    return data;
  }

  const get = (path) => api(path, { method: "GET" });
  const post = (path, body) => api(path, { method: "POST", body: JSON.stringify(body || {}) });

  // ---------- Toast ----------

  let toastTimer = null;
  function showToast(message, isError) {
    const el = $("#toast");
    el.textContent = message;
    el.classList.toggle("error", !!isError);
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 3200);
  }

  // ---------- Modal ----------

  function openModal({ title, desc, confirmLabel = "Confirm", placeholder = "Optional note" }) {
    const overlay = $("#modalOverlay");
    const input = $("#modalInput");
    $("#modalTitle").textContent = title;
    $("#modalDesc").textContent = desc || "";
    input.value = "";
    input.placeholder = placeholder;
    $("#modalConfirm").textContent = confirmLabel;
    overlay.hidden = false;
    input.focus();

    return new Promise((resolve) => {
      function cleanup(result) {
        overlay.hidden = true;
        $("#modalConfirm").removeEventListener("click", onConfirm);
        $("#modalCancel").removeEventListener("click", onCancel);
        overlay.removeEventListener("click", onOverlayClick);
        resolve(result);
      }
      function onConfirm() {
        cleanup(input.value.trim());
      }
      function onCancel() {
        cleanup(null);
      }
      function onOverlayClick(e) {
        if (e.target === overlay) cleanup(null);
      }
      $("#modalConfirm").addEventListener("click", onConfirm);
      $("#modalCancel").addEventListener("click", onCancel);
      overlay.addEventListener("click", onOverlayClick);
    });
  }

  // ---------- Formatting helpers ----------

  function fmtDate(dateStr) {
    if (!dateStr) return "—";
    const d = new Date(dateStr.length <= 10 ? `${dateStr}T00:00:00Z` : dateStr.replace(" ", "T") + "Z");
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: dateStr.length <= 10 ? "UTC" : undefined });
  }

  function fmtDateTime(dateStr) {
    if (!dateStr) return "—";
    const d = new Date(dateStr.replace(" ", "T") + "Z");
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  function todayUTC() {
    const d = new Date();
    return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  }

  function daysFromToday(dateStr) {
    const target = new Date(`${dateStr}T00:00:00Z`);
    return Math.round((target - todayUTC()) / 86400000);
  }

  function dueBadge(dateStr) {
    const diff = daysFromToday(dateStr);
    if (diff < 0) return { cls: "red", label: diff === -1 ? "1 day overdue" : `${-diff} days overdue` };
    if (diff === 0) return { cls: "amber", label: "Due today" };
    if (diff <= 3) return { cls: "green", label: `Due in ${diff}d` };
    return { cls: "gray", label: `Due ${fmtDate(dateStr)}` };
  }

  function mineBadge(op) {
    if (op.pendingDropRequest) return { cls: "violet", label: "Drop requested" };
    if (op.nextDueDate) return dueBadge(op.nextDueDate);
    return { cls: "gray", label: "No cycle scheduled" };
  }

  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---------- Bootstrap ----------

  async function loadBootstrap() {
    const data = await get("/api/bootstrap");
    state.creators = data.creators;
    state.clients = data.clients;
    state.config = data.config;

    const select = $("#creatorSelect");
    select.innerHTML = state.creators
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}${c.isAdmin && c.name !== "Admin" ? " (Admin)" : ""}</option>`)
      .join("");
    state.creatorId = state.creators[0] ? state.creators[0].id : null;
    select.value = String(state.creatorId);

    const clientOptions = state.clients.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("");
    $("#completedClientFilter").insertAdjacentHTML("beforeend", clientOptions);
    $("#subClientFilter").insertAdjacentHTML("beforeend", clientOptions);
    $("#subCreatorFilter").insertAdjacentHTML(
      "beforeend",
      state.creators.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join("")
    );

    select.addEventListener("change", () => {
      state.creatorId = Number(select.value);
      updateRoleUI();
      refreshCurrentTab();
    });

    updateRoleUI();
  }

  function currentCreator() {
    return state.creators.find((c) => c.id === state.creatorId) || null;
  }

  function updateRoleUI() {
    const isAdmin = !!(currentCreator() && currentCreator().isAdmin);
    $$('.tab[data-tab="approvals"], .tab[data-tab="submissions"]').forEach((t) => (t.hidden = !isAdmin));
    $("#newJobBtn").hidden = !isAdmin;
    if (!isAdmin && (state.tab === "approvals" || state.tab === "submissions")) {
      switchTab("board");
    }
  }

  function registerCard(entry) {
    state.cardData.push(entry);
    return state.cardData.length - 1;
  }

  // ---------- Tabs ----------

  function switchTab(tab) {
    state.tab = tab;
    $$(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === tab));
    $$(".view").forEach((v) => (v.hidden = v.id !== `view-${tab}`));
    refreshCurrentTab();
  }

  function refreshCurrentTab() {
    if (state.tab === "board") loadBoard();
    if (state.tab === "approvals") loadApprovals();
    if (state.tab === "submissions") loadSubmissions();
  }

  // ---------- Board ----------

  async function loadBoard() {
    if (!state.creatorId) return;
    const clientId = $("#completedClientFilter").value;
    const qs = new URLSearchParams({ creatorId: String(state.creatorId) });
    if (clientId) qs.set("clientId", clientId);
    try {
      const data = await get(`/api/board?${qs}`);
      state.cardData = [];
      renderUnclaimed(data.unclaimed);
      renderMine(data.mine);
      renderDue(data.due);
      renderCompleted(data.completed);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function renderUnclaimed(ops) {
    $("#count-unclaimed").textContent = ops.length;
    const el = $("#list-unclaimed");
    if (!ops.length) {
      el.innerHTML = `<p class="empty-note">Nothing waiting to be claimed.</p>`;
      return;
    }
    el.innerHTML = ops
      .map((op) => {
        const idx = registerCard({ kind: "unclaimed", op });
        return `
      <div class="op-card" data-card-idx="${idx}">
        <div class="op-card-top">
          <div>
            <div class="op-client">${escapeHtml(op.clientName)}</div>
            <div class="op-task">${escapeHtml(op.taskType)}</div>
          </div>
          <span class="status-dot gray" title="Unclaimed"></span>
        </div>
        <div class="op-meta"><span class="op-meta-item"><strong>${escapeHtml(op.cadenceDescription)}</strong></span></div>
        <div class="op-actions">
          <button class="btn btn-primary btn-sm" data-action="claim" data-op-id="${op.id}">Claim</button>
        </div>
      </div>`;
      })
      .join("");
  }

  function renderMine(ops) {
    $("#count-mine").textContent = ops.length;
    const el = $("#list-mine");
    if (!ops.length) {
      el.innerHTML = `<p class="empty-note">You haven't claimed any ops yet.</p>`;
      return;
    }
    el.innerHTML = ops
      .map((op) => {
        const badge = mineBadge(op);
        const idx = registerCard({ kind: "mine", op });
        const dotCls = op.pendingDropRequest ? "violet" : badge.cls === "red" ? "red" : badge.cls === "amber" ? "amber" : "green";
        return `
      <div class="op-card" data-card-idx="${idx}">
        <div class="op-card-top">
          <div>
            <div class="op-client">${escapeHtml(op.clientName)}</div>
            <div class="op-task">${escapeHtml(op.taskType)}</div>
          </div>
          <span class="status-dot ${dotCls}"></span>
        </div>
        <div class="op-meta">
          <span class="op-meta-item"><strong>${escapeHtml(op.cadenceDescription)}</strong></span>
          ${op.nextDueDate ? `<span class="op-meta-item">Next due ${fmtDate(op.nextDueDate)}</span>` : ""}
        </div>
        <span class="badge ${badge.cls}">${escapeHtml(badge.label)}</span>
        <div class="op-actions">
          <button class="btn btn-ghost btn-sm" data-action="drop" data-op-id="${op.id}" ${op.pendingDropRequest ? "disabled" : ""}>
            ${op.pendingDropRequest ? "Pending approval" : "Request drop"}
          </button>
        </div>
      </div>`;
      })
      .join("");
  }

  function renderDue(cycles) {
    $("#count-due").textContent = cycles.length;
    const el = $("#list-due");
    if (!cycles.length) {
      el.innerHTML = `<p class="empty-note">Nothing due right now. Nice work.</p>`;
      return;
    }
    el.innerHTML = cycles
      .map((c) => {
        const badge = c.cycleStatus === "missed" ? { cls: "red", label: "Missed" } : dueBadge(c.dueDate);
        const idx = registerCard({ kind: "due", op: { ...c, id: c.opId }, cycle: c });
        return `
      <div class="op-card" data-card-idx="${idx}">
        <div class="op-card-top">
          <div>
            <div class="op-client">${escapeHtml(c.clientName)}</div>
            <div class="op-task">${escapeHtml(c.taskType)}</div>
          </div>
          <span class="status-dot ${badge.cls}"></span>
        </div>
        <div class="op-meta"><span class="op-meta-item">Due ${fmtDate(c.dueDate)}</span></div>
        <span class="badge ${badge.cls}">${escapeHtml(badge.label)}</span>
        <div class="op-actions">
          <button class="btn btn-primary btn-sm" data-action="complete" data-cycle-id="${c.cycleId}">Mark done</button>
        </div>
      </div>`;
      })
      .join("");
  }

  function renderCompleted(cycles) {
    const tbody = $("#table-completed tbody");
    const empty = $("#empty-completed");
    if (!cycles.length) {
      tbody.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    tbody.innerHTML = cycles
      .map(
        (c) => `
      <tr>
        <td>${escapeHtml(c.clientName)}</td>
        <td>${escapeHtml(c.taskType)}</td>
        <td>${fmtDate(c.dueDate)}</td>
        <td>${fmtDateTime(c.completedAt)}</td>
      </tr>`
      )
      .join("");
  }

  // ---------- Board actions ----------

  async function claimOp(opId) {
    try {
      await post("/api/ops/claim", { opId, creatorId: state.creatorId });
      showToast("Op claimed.");
      loadBoard();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function dropOp(opId) {
    const requiresApproval = state.config.dropRequiresApproval;
    const note = await openModal({
      title: "Request drop",
      desc: requiresApproval
        ? "An admin will need to approve this before the op returns to the unclaimed pool."
        : "This op will be released back to the unclaimed pool immediately.",
      confirmLabel: requiresApproval ? "Request drop" : "Drop now",
    });
    if (note === null) return;
    try {
      const res = await post("/api/ops/drop", { opId, creatorId: state.creatorId, note });
      showToast(res.status === "released" ? "Op released back to the pool." : "Drop request sent for approval.");
      loadBoard();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function completeCycle(cycleId) {
    try {
      await post("/api/cycles/complete", { cycleId, creatorId: state.creatorId });
      showToast("Marked done.");
      loadBoard();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  // ---------- Approvals ----------

  async function loadApprovals() {
    try {
      const data = await get("/api/admin/approvals");
      state.cardData = [];
      renderApprovals(data.approvals);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function renderApprovals(rows) {
    $("#count-approvals").textContent = rows.length;
    const el = $("#list-approvals");
    const empty = $("#empty-approvals");
    if (!rows.length) {
      el.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    el.innerHTML = rows
      .map((r) => {
        const idx = registerCard({ kind: "approval", op: { ...r, id: r.opId } });
        return `
      <div class="approval-card" data-card-idx="${idx}">
        <div class="op-card-top">
          <div>
            <div class="op-client">${escapeHtml(r.clientName)}</div>
            <div class="op-task">${escapeHtml(r.taskType)} · ${escapeHtml(r.cadenceDescription)}</div>
          </div>
        </div>
        <div class="op-meta">
          <span class="op-meta-item">Requested by <strong>${escapeHtml(r.requestedByName)}</strong></span>
          <span class="op-meta-item">${fmtDateTime(r.requestedAt)}</span>
        </div>
        ${r.note ? `<div class="approval-note">${escapeHtml(r.note)}</div>` : ""}
        <div class="op-actions">
          <button class="btn btn-primary btn-sm" data-action="approve" data-op-id="${r.opId}">Approve</button>
          <button class="btn btn-danger btn-sm" data-action="reject" data-op-id="${r.opId}">Reject</button>
        </div>
      </div>`;
      })
      .join("");
  }

  async function decideApproval(opId, decision) {
    let note = null;
    if (decision === "reject") {
      note = await openModal({ title: "Reject drop request", desc: "Let the creator know why (optional).", confirmLabel: "Reject" });
      if (note === null) return;
    }
    try {
      await post("/api/admin/approvals", { opId, adminId: state.creatorId, decision, note });
      showToast(decision === "approve" ? "Drop approved." : "Drop rejected.");
      loadApprovals();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  // ---------- Submissions ----------

  async function loadSubmissions() {
    const clientId = $("#subClientFilter").value;
    const creatorId = $("#subCreatorFilter").value;
    const from = $("#subFrom").value;
    const to = $("#subTo").value;
    const sortBy = $("#subSortBy").value;
    const sortDir = $("#subSortDir").dataset.dir;

    const qs = new URLSearchParams({ sortBy, sortDir });
    if (clientId) qs.set("clientId", clientId);
    if (creatorId) qs.set("creatorId", creatorId);
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);

    try {
      const data = await get(`/api/admin/submissions?${qs}`);
      renderSubmissions(data.submissions);
    } catch (err) {
      showToast(err.message, true);
    }
  }

  function renderSubmissions(rows) {
    const tbody = $("#table-submissions tbody");
    const empty = $("#empty-submissions");
    if (!rows.length) {
      tbody.innerHTML = "";
      empty.hidden = false;
      return;
    }
    empty.hidden = true;
    tbody.innerHTML = rows
      .map((r) => {
        const late = new Date(r.completedAt.replace(" ", "T") + "Z") > new Date(`${r.dueDate}T23:59:59Z`);
        return `
      <tr>
        <td>${escapeHtml(r.clientName)}</td>
        <td>${escapeHtml(r.taskType)}</td>
        <td>${escapeHtml(r.cadenceDescription)}</td>
        <td>${escapeHtml(r.creatorName)}</td>
        <td>${fmtDate(r.dueDate)}</td>
        <td>${fmtDateTime(r.completedAt)}</td>
        <td>${late ? '<span class="badge red">Late</span>' : '<span class="badge green">On time</span>'}</td>
      </tr>`;
      })
      .join("");
  }

  // ---------- Job detail / create job modal ----------

  function closeDetail() {
    $("#detailOverlay").hidden = true;
    state.detail = null;
  }

  function openJobDetail(entry) {
    state.detail = { mode: "view", kind: entry.kind, op: entry.op, cycle: entry.cycle || null, editing: false, draft: null };
    renderDetailBody();
    $("#detailOverlay").hidden = false;
  }

  function openCreateJob() {
    state.detail = {
      mode: "create",
      draft: {
        clientId: state.clients[0] ? String(state.clients[0].id) : "",
        taskType: "",
        cadenceType: "daily",
        cadenceConfig: { interval: "3", weekdays: [] },
        description: "",
        steps: [],
      },
    };
    renderDetailBody();
    $("#detailOverlay").hidden = false;
  }

  function stepsReadOnly(steps) {
    if (!steps || !steps.length) return `<p class="detail-text muted">No steps added yet.</p>`;
    return `<ol class="steps-list">${steps.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol>`;
  }

  function stepsEditor(steps) {
    const rows = steps
      .map(
        (s, i) => `
      <div class="step-row">
        <input type="text" class="step-text" data-idx="${i}" value="${escapeHtml(s)}" placeholder="Step ${i + 1}" />
        <button type="button" class="step-remove" data-action="remove-step" data-idx="${i}" aria-label="Remove step">&times;</button>
      </div>`
      )
      .join("");
    return `<div class="steps-editor">${rows}</div><button type="button" class="btn btn-ghost btn-sm" data-action="add-step" style="margin-top:8px;">+ Add step</button>`;
  }

  function cadenceFieldsHtml(draft) {
    if (draft.cadenceType === "every_n_days") {
      return `
      <div class="detail-form-field">
        <label>Repeat every N days</label>
        <input type="text" inputmode="numeric" data-field="cadenceInterval" value="${escapeHtml(String(draft.cadenceConfig.interval ?? "3"))}" placeholder="e.g. 3" />
      </div>`;
    }
    if (draft.cadenceType === "custom_weekdays") {
      const selected = draft.cadenceConfig.weekdays || [];
      return `
      <div class="detail-form-field">
        <label>Which weekdays</label>
        <div class="weekday-toggles">
          ${WEEKDAY_NAMES.map((n, i) => `<button type="button" class="weekday-toggle ${selected.includes(i) ? "selected" : ""}" data-action="toggle-weekday" data-day="${i}">${n}</button>`).join("")}
        </div>
      </div>`;
    }
    return "";
  }

  function renderDetailBody() {
    const d = state.detail;
    const body = $("#detailBody");
    if (!d) return;

    if (d.mode === "create") {
      body.innerHTML = `
        <div class="detail-header">
          <div class="detail-client">New job</div>
          <div class="detail-task">Define a recurring op for the unclaimed pool.</div>
        </div>
        <div class="detail-form-field">
          <label>Client</label>
          <select data-field="clientId">
            ${state.clients.map((c) => `<option value="${c.id}" ${String(c.id) === String(d.draft.clientId) ? "selected" : ""}>${escapeHtml(c.name)}</option>`).join("")}
          </select>
        </div>
        <div class="detail-form-field">
          <label>Task type</label>
          <input type="text" data-field="taskType" value="${escapeHtml(d.draft.taskType)}" placeholder="e.g. Client Profile Refresh" />
        </div>
        <div class="detail-form-field">
          <label>Cadence</label>
          <select data-field="cadenceType">
            <option value="daily" ${d.draft.cadenceType === "daily" ? "selected" : ""}>Daily</option>
            <option value="weekly" ${d.draft.cadenceType === "weekly" ? "selected" : ""}>Weekly</option>
            <option value="monthly" ${d.draft.cadenceType === "monthly" ? "selected" : ""}>Monthly</option>
            <option value="every_n_days" ${d.draft.cadenceType === "every_n_days" ? "selected" : ""}>Every N days</option>
            <option value="custom_weekdays" ${d.draft.cadenceType === "custom_weekdays" ? "selected" : ""}>Specific weekdays</option>
          </select>
        </div>
        ${cadenceFieldsHtml(d.draft)}
        <div class="detail-section">
          <div class="detail-section-label">Description <span style="text-transform:none;font-weight:400;">(optional)</span></div>
          <div class="detail-form-field">
            <textarea rows="3" data-field="description" placeholder="What needs to be done?">${escapeHtml(d.draft.description)}</textarea>
          </div>
        </div>
        <div class="detail-section">
          <div class="detail-section-label">Steps <span style="text-transform:none;font-weight:400;">(optional)</span></div>
          ${stepsEditor(d.draft.steps)}
        </div>
        <div class="detail-footer">
          <button class="btn btn-ghost" data-action="cancel-detail">Cancel</button>
          <button class="btn btn-primary" data-action="create-job">Create job</button>
        </div>`;
      return;
    }

    // mode === "view"
    const op = d.op;
    const isAdmin = !!(currentCreator() && currentCreator().isAdmin);
    let badgeHtml = "";
    let footerHtml = "";

    if (d.kind === "unclaimed") {
      badgeHtml = `<span class="badge gray">Unclaimed</span>`;
      footerHtml = `<button class="btn btn-primary" data-action="claim" data-op-id="${op.id}">Claim</button>`;
    } else if (d.kind === "mine") {
      const badge = mineBadge(op);
      badgeHtml = `<span class="badge ${badge.cls}">${escapeHtml(badge.label)}</span>`;
      footerHtml = `<button class="btn btn-ghost" data-action="drop" data-op-id="${op.id}" ${op.pendingDropRequest ? "disabled" : ""}>${op.pendingDropRequest ? "Pending approval" : "Request drop"}</button>`;
    } else if (d.kind === "due") {
      const badge = d.cycle.cycleStatus === "missed" ? { cls: "red", label: "Missed" } : dueBadge(d.cycle.dueDate);
      badgeHtml = `<span class="badge ${badge.cls}">${escapeHtml(badge.label)}</span>`;
      footerHtml = `<button class="btn btn-primary" data-action="complete" data-cycle-id="${d.cycle.cycleId}">Mark done</button>`;
    } else if (d.kind === "approval") {
      badgeHtml = `<span class="badge violet">Drop requested</span>`;
      footerHtml = `
        <button class="btn btn-primary" data-action="approve" data-op-id="${op.id}">Approve</button>
        <button class="btn btn-danger" data-action="reject" data-op-id="${op.id}">Reject</button>`;
    }

    const editing = d.editing;
    const descriptionHtml = editing
      ? `<div class="detail-form-field"><textarea rows="3" data-field="description" placeholder="What needs to be done?">${escapeHtml(d.draft.description)}</textarea></div>`
      : op.description
      ? `<p class="detail-text">${escapeHtml(op.description)}</p>`
      : `<p class="detail-text muted">No description yet.</p>`;
    const stepsHtml = editing ? stepsEditor(d.draft.steps) : stepsReadOnly(op.steps);

    body.innerHTML = `
      <div class="detail-header">
        <div class="detail-client">${escapeHtml(op.clientName)}</div>
        <div class="detail-task">${escapeHtml(op.taskType)}</div>
      </div>
      <div class="detail-badges">
        <span class="badge gray">${escapeHtml(op.cadenceDescription)}</span>
        ${badgeHtml}
      </div>
      ${
        d.kind === "mine" && op.nextDueDate
          ? `<div class="op-meta"><span class="op-meta-item">Next due ${fmtDate(op.nextDueDate)}</span></div>`
          : ""
      }
      ${
        d.kind === "approval"
          ? `<div class="op-meta"><span class="op-meta-item">Requested by <strong>${escapeHtml(op.requestedByName)}</strong></span><span class="op-meta-item">${fmtDateTime(op.requestedAt)}</span></div>
             ${op.note ? `<div class="approval-note">${escapeHtml(op.note)}</div>` : ""}`
          : ""
      }
      <div class="detail-section">
        <div class="detail-section-label">Description</div>
        ${descriptionHtml}
      </div>
      <div class="detail-section">
        <div class="detail-section-label">Steps</div>
        ${stepsHtml}
      </div>
      ${isAdmin && !editing ? `<div class="detail-note"><button class="btn btn-ghost btn-sm" data-action="edit-details">Edit description &amp; steps</button></div>` : ""}
      <div class="detail-footer">
        ${
          editing
            ? `<button class="btn btn-ghost" data-action="cancel-edit">Cancel</button><button class="btn btn-primary" data-action="save-details" data-op-id="${op.id}">Save details</button>`
            : footerHtml
        }
      </div>`;
  }

  function startEditDetails() {
    const d = state.detail;
    d.editing = true;
    d.draft = { description: d.op.description || "", steps: [...(d.op.steps || [])] };
    renderDetailBody();
  }

  function cancelEditDetails() {
    state.detail.editing = false;
    state.detail.draft = null;
    renderDetailBody();
  }

  async function saveDetails(opId) {
    const d = state.detail;
    const steps = d.draft.steps.map((s) => s.trim()).filter(Boolean);
    try {
      await post("/api/ops/details", { opId, adminId: state.creatorId, description: d.draft.description, steps });
      showToast("Job details saved.");
      d.op.description = d.draft.description.trim() || null;
      d.op.steps = steps;
      d.editing = false;
      d.draft = null;
      renderDetailBody();
      refreshCurrentTab();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  async function submitCreateJob() {
    const d = state.detail.draft;
    if (!d.clientId || !d.taskType.trim()) {
      showToast("Client and task type are required.", true);
      return;
    }
    if (d.cadenceType === "custom_weekdays" && !(d.cadenceConfig.weekdays || []).length) {
      showToast("Pick at least one weekday.", true);
      return;
    }
    try {
      await post("/api/ops/create", {
        adminId: state.creatorId,
        clientId: Number(d.clientId),
        taskType: d.taskType.trim(),
        cadenceType: d.cadenceType,
        cadenceConfig: { interval: Number(d.cadenceConfig.interval) || 1, weekdays: d.cadenceConfig.weekdays || [] },
        description: d.description,
        steps: d.steps.map((s) => s.trim()).filter(Boolean),
      });
      showToast("Job created.");
      closeDetail();
      loadBoard();
    } catch (err) {
      showToast(err.message, true);
    }
  }

  $("#detailClose").addEventListener("click", closeDetail);
  $("#detailOverlay").addEventListener("click", (e) => {
    if (e.target.id === "detailOverlay") closeDetail();
  });
  $("#newJobBtn").addEventListener("click", openCreateJob);

  $("#detailBody").addEventListener("input", (e) => {
    const target = e.target;
    if (!state.detail) return;
    const draft = state.detail.draft;
    if (!draft) return;
    if (target.matches(".step-text")) {
      draft.steps[Number(target.dataset.idx)] = target.value;
      return;
    }
    const field = target.dataset.field;
    if (!field) return;
    if (field === "cadenceInterval") {
      draft.cadenceConfig.interval = target.value;
    } else {
      draft[field] = target.value;
    }
  });

  $("#detailBody").addEventListener("change", (e) => {
    if (!state.detail || !state.detail.draft) return;
    const field = e.target.dataset.field;
    if (!field) return;
    state.detail.draft[field] = e.target.value;
    if (state.detail.mode === "create" && field === "cadenceType") {
      if (e.target.value === "every_n_days" && !state.detail.draft.cadenceConfig.interval) {
        state.detail.draft.cadenceConfig.interval = "3";
      }
      renderDetailBody();
    }
  });

  // ---------- Event delegation ----------

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (btn) {
      const { action, opId, cycleId, idx, day } = btn.dataset;
      const insideDetail = !!btn.closest("#detailOverlay");

      if (action === "claim") claimOp(Number(opId));
      if (action === "drop") dropOp(Number(opId));
      if (action === "complete") completeCycle(Number(cycleId));
      if (action === "approve") decideApproval(Number(opId), "approve");
      if (action === "reject") decideApproval(Number(opId), "reject");
      if (action === "edit-details") startEditDetails();
      if (action === "cancel-edit") cancelEditDetails();
      if (action === "save-details") saveDetails(Number(opId));
      if (action === "cancel-detail") closeDetail();
      if (action === "create-job") submitCreateJob();
      if (action === "add-step") {
        state.detail.draft.steps.push("");
        renderDetailBody();
      }
      if (action === "remove-step") {
        state.detail.draft.steps.splice(Number(idx), 1);
        renderDetailBody();
      }
      if (action === "toggle-weekday") {
        const weekdays = state.detail.draft.cadenceConfig.weekdays || [];
        const dayNum = Number(day);
        state.detail.draft.cadenceConfig.weekdays = weekdays.includes(dayNum)
          ? weekdays.filter((d) => d !== dayNum)
          : [...weekdays, dayNum];
        renderDetailBody();
      }

      if (insideDetail && ["claim", "drop", "complete", "approve", "reject"].includes(action)) {
        closeDetail();
      }
      return;
    }

    const card = e.target.closest(".op-card[data-card-idx], .approval-card[data-card-idx]");
    if (card) {
      const entry = state.cardData[Number(card.dataset.cardIdx)];
      if (entry) openJobDetail(entry);
    }
  });

  $$(".tab").forEach((t) => t.addEventListener("click", () => switchTab(t.dataset.tab)));

  $("#completedClientFilter").addEventListener("change", loadBoard);
  ["#subClientFilter", "#subCreatorFilter", "#subFrom", "#subTo", "#subSortBy"].forEach((sel) => {
    $(sel).addEventListener("change", loadSubmissions);
  });
  $("#subSortDir").addEventListener("click", () => {
    const btn = $("#subSortDir");
    const next = btn.dataset.dir === "asc" ? "desc" : "asc";
    btn.dataset.dir = next;
    btn.textContent = next === "asc" ? "↑ Oldest" : "↓ Newest";
    loadSubmissions();
  });

  // ---------- Init ----------

  loadBootstrap().then(() => switchTab("board"));
})();
