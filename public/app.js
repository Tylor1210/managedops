(() => {
  "use strict";

  const state = {
    creators: [],
    clients: [],
    config: { dropRequiresApproval: true },
    creatorId: null,
    tab: "board",
  };

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
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}${c.isAdmin ? " (Admin)" : ""}</option>`)
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
    if (!isAdmin && (state.tab === "approvals" || state.tab === "submissions")) {
      switchTab("board");
    }
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
      .map(
        (op) => `
      <div class="op-card">
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
      </div>`
      )
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
        const badge = op.pendingDropRequest
          ? { cls: "violet", label: "Drop requested" }
          : op.nextDueDate
          ? dueBadge(op.nextDueDate)
          : { cls: "gray", label: "No cycle scheduled" };
        const dotCls = op.pendingDropRequest ? "violet" : badge.cls === "red" ? "red" : badge.cls === "amber" ? "amber" : "green";
        return `
      <div class="op-card">
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
        return `
      <div class="op-card">
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
      .map(
        (r) => `
      <div class="approval-card">
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
      </div>`
      )
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

  // ---------- Event delegation ----------

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const { action, opId, cycleId } = btn.dataset;
    if (action === "claim") claimOp(Number(opId));
    if (action === "drop") dropOp(Number(opId));
    if (action === "complete") completeCycle(Number(cycleId));
    if (action === "approve") decideApproval(Number(opId), "approve");
    if (action === "reject") decideApproval(Number(opId), "reject");
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
