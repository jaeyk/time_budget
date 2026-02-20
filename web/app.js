const DOMAINS = ["Research", "Teaching", "Service", "Admin", "Other"];
const IMPACT_LEVELS = ["High", "Medium", "Low"];
const IMPACT_WEIGHT = { High: 3, Medium: 2, Low: 1 };
const STATUSES = ["Backlog", "Ready", "Doing", "Done"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];
const STORAGE_KEY = "timebudget_state_v1";

let state = {
  daily_hours: 8,
  budgets: {},
  tasks: [],
  last_week_key: null,
  active_timer: null,
  log_project_id: null,
  updated_at: null,
};

let saveTimer = null;
let editingTaskId = null;
let timerTickHandle = null;
let draggingTaskId = null;

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function normalizeStateShape() {
  if (!state.budgets) state.budgets = {};
  if (!state.tasks) state.tasks = [];
  if (!state.active_timer) state.active_timer = null;
  if (state.log_project_id == null) state.log_project_id = null;
  if (!state.last_week_key) state.last_week_key = currentWeekKey();
}

function fmt(n) {
  return num(n).toFixed(1).replace(/\.0$/, "");
}

function todayIso() {
  return toIsoLocal(new Date());
}

function parseIsoDate(isoDate) {
  if (!isoDate) return null;
  const raw = String(isoDate);
  const d = raw.includes("T") ? new Date(raw) : new Date(raw + "T00:00:00");
  return Number.isNaN(d.getTime()) ? null : d;
}

function toIsoLocal(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function toClockLocal(d) {
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function weekMonday(dateObj) {
  const d = new Date(dateObj.getFullYear(), dateObj.getMonth(), dateObj.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function currentWeekKey() {
  return toIsoLocal(weekMonday(new Date()));
}

function currentWeekDatesMonFri() {
  const monday = weekMonday(new Date());
  const out = [];
  for (let i = 0; i < 5; i += 1) {
    const d = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + i);
    out.push(toIsoLocal(d));
  }
  return out;
}

function formatElapsed(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function daysBetween(startIso, endIso) {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (!start || !end) return null;
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24);
}

function estimatedUrgency(t) {
  const totalDays = daysBetween(t.start_date, t.deadline);
  if (totalDays == null || totalDays <= 0) return 3;
  const daysLeft = daysBetween(todayIso(), t.deadline);
  if (daysLeft == null) return 3;
  if (daysLeft <= 0) return 5;
  const ratioLeft = daysLeft / totalDays;
  if (ratioLeft <= 0.2) return 5;
  if (ratioLeft <= 0.4) return 4;
  if (ratioLeft <= 0.6) return 3;
  if (ratioLeft <= 0.8) return 2;
  return 1;
}

function urgencyLabel(level) {
  if (level >= 5) return "Critical";
  if (level === 4) return "High";
  if (level === 3) return "Medium";
  if (level === 2) return "Low";
  return "Very Low";
}

function impactWeight(t) {
  return IMPACT_WEIGHT[t.impact] || 2;
}

function makeUpDebtHours(t) {
  return Math.max(0, num(t.debt_hours, 0));
}

function normalizedWeekArray(values, fallbackTotal = 0) {
  if (Array.isArray(values) && values.length === 5) {
    return values.map((v) => Math.max(0, num(v, 0)));
  }
  const perDay = Math.max(0, num(fallbackTotal, 0)) / 5;
  return [perDay, perDay, perDay, perDay, perDay];
}

function normalizedTextArray(values) {
  if (Array.isArray(values) && values.length === 5) {
    return values.map((v) => (v ? String(v) : ""));
  }
  return ["", "", "", "", ""];
}

function weeklyPlannedTotal(t) {
  return t.daily_plan.reduce((acc, v) => acc + num(v, 0), 0);
}

function weeklyActualTotal(t) {
  return t.daily_actual.reduce((acc, v) => acc + num(v, 0), 0);
}

function totalLoggedActualHours() {
  return state.tasks.reduce((acc, t) => acc + weeklyActualTotal(t), 0);
}

function isProjectActiveOnDate(task, isoDay) {
  if (task.start_date && isoDay < task.start_date) return false;
  if (task.deadline && isoDay > task.deadline) return false;
  return true;
}

function normalizeTask(t) {
  let impact = t.impact;
  if (!IMPACT_LEVELS.includes(impact)) {
    const legacyImportance = num(t.importance, 3);
    if (legacyImportance >= 4) impact = "High";
    else if (legacyImportance <= 2) impact = "Low";
    else impact = "Medium";
  }

  return {
    id: t.id || `KB-${String(Date.now()).slice(-6)}`,
    title: t.title || "",
    domain: DOMAINS.includes(t.domain) ? t.domain : "Research",
    status: STATUSES.includes(t.status) ? t.status : "Backlog",
    impact,
    start_date: t.start_date || "",
    deadline: t.deadline || "",
    research_split: Math.max(0, num(t.research_split, 0)),
    daily_plan: normalizedWeekArray(t.daily_plan, num(t.planned_hours, 0)),
    daily_actual: normalizedWeekArray(t.daily_actual, num(t.actual_hours, 0)),
    daily_start: normalizedTextArray(t.daily_start),
    daily_end: normalizedTextArray(t.daily_end),
    committed_hours: num(t.committed_hours, 0),
    baseline_deadline: t.baseline_deadline || (t.deadline || ""),
    debt_hours: num(t.debt_hours, 0),
    tracked_total_hours: Math.max(0, num(t.tracked_total_hours, 0)),
    kanban_order: num(t.kanban_order, 0),
  };
}

function sortKanbanItems(items) {
  return items.slice().sort((a, b) => {
    const oa = num(a.kanban_order, 0);
    const ob = num(b.kanban_order, 0);
    if (oa !== ob) return oa - ob;
    return a.title.localeCompare(b.title);
  });
}

function reindexStatus(status) {
  const items = sortKanbanItems(state.tasks.filter((t) => t.status === status));
  items.forEach((t, idx) => { t.kanban_order = idx + 1; });
}

function ensureKanbanOrder() {
  STATUSES.forEach((status) => {
    const items = sortKanbanItems(state.tasks.filter((t) => t.status === status));
    items.forEach((t, idx) => {
      if (!Number.isFinite(num(t.kanban_order, NaN)) || num(t.kanban_order, 0) <= 0) {
        t.kanban_order = idx + 1;
      }
    });
    reindexStatus(status);
  });
}

function moveTaskToColumnEnd(taskId, targetStatus) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task || !STATUSES.includes(targetStatus)) return false;
  task.status = targetStatus;
  reindexStatus(targetStatus);
  const maxOrder = state.tasks
    .filter((t) => t.status === targetStatus)
    .reduce((m, t) => Math.max(m, num(t.kanban_order, 0)), 0);
  task.kanban_order = maxOrder + 1;
  reindexStatus(targetStatus);
  return true;
}

function moveTaskBefore(taskId, beforeTaskId, targetStatus) {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task || taskId === beforeTaskId || !STATUSES.includes(targetStatus)) return false;
  const beforeTask = state.tasks.find((t) => t.id === beforeTaskId);
  if (!beforeTask || beforeTask.status !== targetStatus) return false;

  const ordered = sortKanbanItems(
    state.tasks.filter((t) => t.status === targetStatus && t.id !== taskId)
  );
  const output = [];
  let inserted = false;
  ordered.forEach((t) => {
    if (t.id === beforeTaskId) {
      output.push(task);
      inserted = true;
    }
    output.push(t);
  });
  if (!inserted) output.push(task);

  task.status = targetStatus;
  output.forEach((t, idx) => { t.kanban_order = idx + 1; });
  return true;
}

function refreshAutoDebt() {
  let changed = false;

  // Project plan is based on Research budget + user split percentages.
  const weekDays = currentWeekDatesMonFri();
  const researchBudget = Math.max(0, num(state.budgets.Research, 0));
  const researchTasks = state.tasks.filter((t) => t.domain === "Research" && t.status !== "Done");

  // Reset plans for all tasks; only research gets budget-based plan.
  state.tasks.forEach((t) => { t.daily_plan = [0, 0, 0, 0, 0]; });

  const splitSum = researchTasks.reduce((acc, t) => acc + Math.max(0, num(t.research_split, 0)), 0);
  const effectiveWeight = (t) => {
    if (splitSum > 0) return Math.max(0, num(t.research_split, 0));
    if (state.log_project_id) return t.id === state.log_project_id ? 1 : 0;
    return researchTasks.length > 0 && t.id === researchTasks[0].id ? 1 : 0;
  };
  const effectiveTotalWeight = researchTasks.reduce((acc, t) => acc + effectiveWeight(t), 0);

  if (researchBudget > 0 && effectiveTotalWeight > 0) {
    researchTasks.forEach((t) => {
      const weeklyHours = researchBudget * (effectiveWeight(t) / effectiveTotalWeight);
      const activeIdx = [];
      for (let i = 0; i < weekDays.length; i += 1) {
        if (isProjectActiveOnDate(t, weekDays[i])) activeIdx.push(i);
      }
      if (activeIdx.length > 0) {
        const perDay = weeklyHours / activeIdx.length;
        activeIdx.forEach((i) => { t.daily_plan[i] = perDay; });
      }
    });
    changed = true;
  }

  // Delay debt for high-impact research projects.
  state.tasks.forEach((t) => {
    if (num(t.debt_hours, 0) <= 0.001) {
      const planned = weeklyPlannedTotal(t);
      if (Math.abs(num(t.committed_hours, 0) - planned) > 0.001) {
        t.committed_hours = planned;
        changed = true;
      }
    }

    if (!t.baseline_deadline && t.deadline) {
      t.baseline_deadline = t.deadline;
      changed = true;
    }

    if (t.domain === "Research" && t.impact === "High" && t.baseline_deadline && t.deadline) {
      const delayDays = daysBetween(t.baseline_deadline, t.deadline);
      if (delayDays != null && delayDays > 0.01) {
        const delayWeeks = delayDays / 7;
        const debtAdded = delayWeeks * Math.max(0, num(t.committed_hours, 0));
        t.debt_hours = Math.max(0, num(t.debt_hours, 0) + debtAdded);
        t.baseline_deadline = t.deadline;
        changed = true;
      } else if (delayDays != null && delayDays < -0.01) {
        t.baseline_deadline = t.deadline;
        changed = true;
      }
    }
  });

  return changed;
}

async function loadState() {
  let loaded = null;
  const status = document.getElementById("dataStatus");

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) loaded = JSON.parse(raw);
  } catch {
    loaded = null;
  }

  if (!loaded) {
    try {
      const res = await fetch("/api/state");
      if (res.ok) loaded = await res.json();
    } catch {
      loaded = null;
    }
  }

  state = loaded && typeof loaded === "object" ? loaded : {};

  if (state.daily_hours == null) {
    const weekly = num(state.weekly_hours, 40);
    state.daily_hours = weekly / 5;
  } else {
    state.daily_hours = num(state.daily_hours, 8);
  }

  normalizeStateShape();

  DOMAINS.forEach((d) => {
    if (state.budgets[d] == null) state.budgets[d] = 0;
  });

  state.tasks = state.tasks.map(normalizeTask);
  ensureKanbanOrder();
  if (!state.log_project_id && state.tasks.length > 0) {
    state.log_project_id = state.tasks[0].id;
  } else if (state.log_project_id) {
    const exists = state.tasks.some((t) => t.id === state.log_project_id);
    if (!exists) state.log_project_id = state.tasks.length > 0 ? state.tasks[0].id : null;
  }

  if (status) setDataStatus("Local auto-save is enabled.");
  render();
}

function persistStateSync(updateUi = true) {
  const el = document.getElementById("saveState");
  state.updated_at = new Date().toISOString();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  if (updateUi && el) {
    el.textContent = `Saved locally ${new Date().toLocaleTimeString()}`;
  }
}

async function mirrorStateToServer() {
  try {
    const res = await fetch("/api/state", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function saveState() {
  const el = document.getElementById("saveState");
  try {
    persistStateSync(true);
    await mirrorStateToServer();
  } catch (err) {
    const msg = err && err.message ? err.message : "unknown";
    if (el) el.textContent = `Local save error: ${msg}`;
  }
}

function scheduleSave() {
  try {
    persistStateSync(true);
  } catch (err) {
    const msg = err && err.message ? err.message : "unknown";
    const el = document.getElementById("saveState");
    if (el) el.textContent = `Local save error: ${msg}`;
  }
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    await mirrorStateToServer();
  }, 120);
}

function setDataStatus(text, klass = "muted") {
  const el = document.getElementById("dataStatus");
  if (!el) return;
  el.textContent = text;
  el.className = klass;
}

function exportStateJson() {
  try {
    const copy = { ...state, updated_at: new Date().toISOString() };
    const blob = new Blob([JSON.stringify(copy, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `timebudget-state-${todayIso()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setDataStatus("Exported JSON backup.", "good");
  } catch (err) {
    const msg = err && err.message ? err.message : "unknown";
    setDataStatus(`Export error: ${msg}`, "bad");
  }
}

async function importStateJson(file) {
  if (!file) return;
  try {
    const text = await file.text();
    const incoming = JSON.parse(text);
    if (!incoming || typeof incoming !== "object") throw new Error("JSON must be an object");
    if (!incoming.budgets || !Array.isArray(incoming.tasks)) throw new Error("Missing budgets/tasks");

    state = incoming;
    if (state.daily_hours == null) {
      const weekly = num(state.weekly_hours, 40);
      state.daily_hours = weekly / 5;
    } else {
      state.daily_hours = num(state.daily_hours, 8);
    }
    normalizeStateShape();
    DOMAINS.forEach((d) => {
      if (state.budgets[d] == null) state.budgets[d] = 0;
    });
    state.tasks = state.tasks.map(normalizeTask);
    if (!state.log_project_id && state.tasks.length > 0) state.log_project_id = state.tasks[0].id;
    await saveState();
    render();
    setDataStatus(`Imported ${file.name}.`, "good");
  } catch (err) {
    const msg = err && err.message ? err.message : "invalid json";
    setDataStatus(`Import error: ${msg}`, "bad");
  }
}

function renderWeekly() {
  const dailyHours = document.getElementById("dailyHours");
  const summary = document.getElementById("weeklySummary");
  dailyHours.value = state.daily_hours;

  const weeklyCapacity = num(state.daily_hours) * 5;
  const totalBudget = DOMAINS.reduce((sum, d) => sum + num(state.budgets[d]), 0);
  const gap = weeklyCapacity - totalBudget;
  summary.className = gap < 0 ? "bad" : "muted";
  summary.textContent = `This week (Mon-Fri): ${fmt(weeklyCapacity)}h available | ${fmt(totalBudget)}h assigned | ${fmt(gap)}h unassigned`;

  dailyHours.onchange = () => {
    state.daily_hours = num(dailyHours.value, 8);
    render();
    scheduleSave();
  };
}

function renderBudgets() {
  const box = document.getElementById("budgets");
  box.innerHTML = "";

  DOMAINS.forEach((domain) => {
    const budget = num(state.budgets[domain]);
    const card = document.createElement("div");
    card.className = "panel";
    card.innerHTML = `<div><strong>${domain}</strong></div><label>Budget h/wk <input class="small" type="number" step="0.5" min="0" value="${budget}" /></label>`;
    const input = card.querySelector("input");
    input.addEventListener("change", () => {
      state.budgets[domain] = num(input.value);
      render();
      scheduleSave();
    });
    box.appendChild(card);
  });
}

function renderKanbanDashboard() {
  const board = document.getElementById("kanbanBoard");
  board.innerHTML = "";

  STATUSES.forEach((status) => {
    const col = document.createElement("div");
    col.className = "kanban-col";

    const heading = document.createElement("h3");
    heading.textContent = status;
    col.appendChild(heading);

    const items = sortKanbanItems(state.tasks.filter((t) => t.status === status));

    col.addEventListener("dragover", (e) => {
      e.preventDefault();
      col.classList.add("drop-target");
    });
    col.addEventListener("dragleave", () => col.classList.remove("drop-target"));
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("drop-target");
      const taskId = e.dataTransfer.getData("text/task-id") || draggingTaskId;
      if (!taskId) return;
      if (moveTaskToColumnEnd(taskId, status)) {
        render();
        scheduleSave();
      }
    });

    if (items.length === 0) {
      const empty = document.createElement("div");
      empty.className = "muted";
      empty.textContent = "No projects";
      col.appendChild(empty);
    } else {
      items.forEach((t) => {
        const card = document.createElement("div");
        card.className = "kanban-card";
        const urgency = urgencyLabel(estimatedUrgency(t));
        const debt = makeUpDebtHours(t);
        const splitTxt = t.domain === "Research" ? ` | split=${fmt(t.research_split)}%` : "";
        const tracked = Math.max(0, num(t.tracked_total_hours, 0));
        card.innerHTML = `<strong>${t.title}</strong><br/><span class="muted">${t.domain} | ${t.impact} impact | ${urgency} pressure${splitTxt}</span><br/><span class="muted">Tracked total: ${fmt(tracked)}h</span>${debt > 0 ? `<br/><span class="bad">Debt: ${fmt(debt)}h</span>` : ""}`;
        card.draggable = true;
        card.addEventListener("dragstart", (e) => {
          draggingTaskId = t.id;
          card.classList.add("dragging");
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/task-id", t.id);
        });
        card.addEventListener("dragend", () => {
          draggingTaskId = null;
          card.classList.remove("dragging");
          document.querySelectorAll(".drop-target").forEach((el) => el.classList.remove("drop-target"));
        });
        card.addEventListener("dragover", (e) => {
          e.preventDefault();
          e.stopPropagation();
          card.classList.add("drop-target");
        });
        card.addEventListener("dragleave", () => card.classList.remove("drop-target"));
        card.addEventListener("drop", (e) => {
          e.preventDefault();
          e.stopPropagation();
          card.classList.remove("drop-target");
          const taskId = e.dataTransfer.getData("text/task-id") || draggingTaskId;
          if (!taskId) return;
          if (moveTaskBefore(taskId, t.id, status)) {
            render();
            scheduleSave();
          }
        });

        const actions = document.createElement("div");
        actions.className = "kanban-actions";

        const move = document.createElement("select");
        move.className = "kanban-move";
        STATUSES.forEach((s) => {
          const o = document.createElement("option");
          o.value = s;
          o.textContent = s;
          if (t.status === s) o.selected = true;
          move.appendChild(o);
        });
        move.addEventListener("change", () => {
          t.status = move.value;
          render();
          scheduleSave();
        });

        const editBtn = document.createElement("button");
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", () => openEditor(t.id));

        const deleteBtn = document.createElement("button");
        deleteBtn.textContent = "Delete";
        deleteBtn.addEventListener("click", () => {
          const ok = window.confirm(`Delete project: ${t.title}?`);
          if (!ok) return;
          const i = state.tasks.findIndex((x) => x.id === t.id);
          if (i >= 0) state.tasks.splice(i, 1);
          if (state.log_project_id === t.id) {
            state.log_project_id = state.tasks.length > 0 ? state.tasks[0].id : null;
          }
          render();
          try {
            persistStateSync(true);
          } catch {
            scheduleSave();
          }
        });

        actions.appendChild(move);
        actions.appendChild(editBtn);
        actions.appendChild(deleteBtn);
        card.appendChild(actions);
        col.appendChild(card);
      });
    }

    board.appendChild(col);
  });
}

function normalizeDomain(raw, fallback) {
  return DOMAINS.includes(raw) ? raw : fallback;
}

function normalizeImpact(raw, fallback) {
  return IMPACT_LEVELS.includes(raw) ? raw : fallback;
}

function openEditor(taskId) {
  const t = state.tasks.find((x) => x.id === taskId);
  if (!t) return;
  editingTaskId = taskId;

  document.getElementById("editTitle").value = t.title || "";
  document.getElementById("editDomain").value = t.domain || "Research";
  document.getElementById("editImpact").value = t.impact || "Medium";
  document.getElementById("editStartDate").value = t.start_date || "";
  document.getElementById("editDeadline").value = t.deadline || "";
  document.getElementById("editResearchSplit").value = String(Math.max(0, num(t.research_split, 0)));

  document.getElementById("editorPanel").classList.remove("hidden");
}

function closeEditor() {
  editingTaskId = null;
  document.getElementById("editorPanel").classList.add("hidden");
}

function saveEditor() {
  if (!editingTaskId) return;
  const t = state.tasks.find((x) => x.id === editingTaskId);
  if (!t) return;

  const title = document.getElementById("editTitle").value.trim();
  if (!title) return;
  const domain = document.getElementById("editDomain").value;
  const impact = document.getElementById("editImpact").value;
  const start = document.getElementById("editStartDate").value.trim();
  const end = document.getElementById("editDeadline").value.trim();
  const split = Math.max(0, num(document.getElementById("editResearchSplit").value, 0));

  t.title = title;
  t.domain = normalizeDomain(domain, t.domain);
  t.impact = normalizeImpact(impact, t.impact);
  t.start_date = start;
  t.deadline = end;
  t.research_split = t.domain === "Research" ? split : 0;

  closeEditor();
  render();
  scheduleSave();
}

function renderExecutionLog() {
  const body = document.getElementById("logBody");
  body.innerHTML = "";
  const weekDays = currentWeekDatesMonFri();

  const summary = document.getElementById("executionDebtSummary");
  const researchTarget = Math.max(0, num(state.budgets.Research, 0));
  const researchActual = state.tasks
    .filter((t) => t.domain === "Research")
    .reduce((acc, t) => acc + weeklyActualTotal(t), 0);
  summary.textContent = `Research target this week: ${fmt(researchTarget)}h | Logged actual: ${fmt(researchActual)}h`;

  const select = document.getElementById("logProjectSelect");
  select.innerHTML = "";
  const sorted = state.tasks.slice().sort((a, b) => a.title.localeCompare(b.title));
  sorted.forEach((t) => {
    const o = document.createElement("option");
    o.value = t.id;
    o.textContent = t.title;
    if (t.id === state.log_project_id) o.selected = true;
    select.appendChild(o);
  });
  select.onchange = () => {
    state.log_project_id = select.value || null;
    render();
    scheduleSave();
  };
  const t = state.tasks.find((x) => x.id === state.log_project_id) || null;
  if (!t) return;

  for (let i = 0; i < WEEKDAYS.length; i += 1) {
    const tr = document.createElement("tr");

    const dayTd = document.createElement("td");
    dayTd.textContent = WEEKDAYS[i];

    const planTd = document.createElement("td");
    planTd.textContent = fmt(num(t.daily_plan[i], 0));
    planTd.className = "muted";

    const startTd = document.createElement("td");
    startTd.textContent = t.daily_start[i] || "-";

    const endTd = document.createElement("td");
    endTd.textContent = t.daily_end[i] || "-";

    const actualTd = document.createElement("td");
    actualTd.innerHTML = `<span class="actual-value">${fmt(num(t.daily_actual[i], 0))}</span>`;

    [dayTd, planTd, startTd, endTd, actualTd].forEach((td) => tr.appendChild(td));
    body.appendChild(tr);
  }
}

function addProject() {
  const titleInput = document.getElementById("newTitle");
  const domainInput = document.getElementById("newDomain");
  const impactInput = document.getElementById("newImpact");
  const startDateInput = document.getElementById("newStartDate");
  const deadlineInput = document.getElementById("newDeadline");

  const title = titleInput.value.trim();
  if (!title) return;

  const startDate = startDateInput.value || todayIso();
  const deadline = deadlineInput.value || "";

  const task = normalizeTask({
    id: `KB-${String(Date.now()).slice(-6)}`,
    title,
    domain: domainInput.value,
    status: "Backlog",
    impact: impactInput.value || (domainInput.value === "Research" ? "High" : "Medium"),
    start_date: startDate,
    deadline,
    research_split: domainInput.value === "Research" ? 0 : 0,
    daily_plan: [0, 0, 0, 0, 0],
    daily_actual: [0, 0, 0, 0, 0],
    daily_start: ["", "", "", "", ""],
    daily_end: ["", "", "", "", ""],
    committed_hours: 0,
    baseline_deadline: deadline,
    debt_hours: 0,
    kanban_order: 0,
  });
  state.tasks.push(task);
  ensureKanbanOrder();

  titleInput.value = "";
  impactInput.value = domainInput.value === "Research" ? "High" : "Medium";
  startDateInput.value = "";
  deadlineInput.value = "";
  if (!state.log_project_id) state.log_project_id = task.id;

  render();
  scheduleSave();
}

function autoAdvanceWeekIfNeeded() {
  const nowKey = currentWeekKey();
  if (state.last_week_key === nowKey) return false;

  if (state.active_timer) stopActiveTimer(false);

  state.tasks.forEach((t) => {
    const planned = weeklyPlannedTotal(t);
    const actual = weeklyActualTotal(t);
    const netGap = planned - actual;
    t.debt_hours = Math.max(0, num(t.debt_hours, 0) + netGap);
    t.daily_actual = [0, 0, 0, 0, 0];
    t.daily_start = ["", "", "", "", ""];
    t.daily_end = ["", "", "", "", ""];
  });
  state.last_week_key = nowKey;
  return true;
}

function startTimer(taskId, dayIndex) {
  const t = state.tasks.find((x) => x.id === taskId);
  if (!t) return;
  if (state.active_timer) {
    const sameTimer = state.active_timer.task_id === taskId
      && num(state.active_timer.day_index, -999) === num(dayIndex, -999);
    if (!sameTimer) return;
    if (state.active_timer.started_at) return;
    state.active_timer.started_at = new Date().toISOString();
  } else {
    const now = new Date();
    if (dayIndex >= 0 && dayIndex < 5) t.daily_start[dayIndex] = toClockLocal(now);
    state.active_timer = {
      task_id: taskId,
      day_index: dayIndex,
      started_at: now.toISOString(),
      elapsed_ms: 0,
    };
  }
  render();
  scheduleSave();
}

function currentElapsedMs(timer, now = Date.now()) {
  if (!timer) return 0;
  const baseMs = Math.max(0, num(timer.elapsed_ms, 0));
  if (!timer.started_at) return baseMs;
  const started = parseIsoDate(timer.started_at);
  if (!started) return baseMs;
  return Math.max(0, baseMs + (now - started.getTime()));
}

function pauseActiveTimer(renderAfter = true) {
  if (!state.active_timer || !state.active_timer.started_at) return;
  state.active_timer.elapsed_ms = currentElapsedMs(state.active_timer);
  state.active_timer.started_at = null;
  if (renderAfter) render();
  scheduleSave();
}

function stopActiveTimer(renderAfter = true) {
  if (!state.active_timer) return;
  const t = state.tasks.find((x) => x.id === state.active_timer.task_id);
  const idx = num(state.active_timer.day_index, -1);
  const now = new Date();
  const elapsedHours = currentElapsedMs(state.active_timer, now.getTime()) / (1000 * 60 * 60);
  if (t && elapsedHours > 0) {
    if (idx >= 0 && idx < 5) {
      t.daily_actual[idx] = Math.max(0, num(t.daily_actual[idx], 0) + elapsedHours);
      t.daily_end[idx] = toClockLocal(now);
    }
    t.tracked_total_hours = Math.max(0, num(t.tracked_total_hours, 0) + elapsedHours);
  }
  state.active_timer = null;
  if (renderAfter) render();
  scheduleSave();
}

function renderProjectProgress() {
  const progressText = document.getElementById("logProgressText");
  const progressFill = document.getElementById("logProgressFill");
  const t = state.tasks.find((x) => x.id === state.log_project_id) || null;
  if (!progressText || !progressFill) return;
  if (!t) {
    progressText.textContent = "No project selected.";
    progressFill.style.width = "0%";
    return;
  }
  const plannedTotal = weeklyPlannedTotal(t);
  const actualTotal = weeklyActualTotal(t);
  const trackedTotal = Math.max(0, num(t.tracked_total_hours, 0));
  const pct = plannedTotal <= 0 ? 0 : Math.min(100, (actualTotal / plannedTotal) * 100);
  progressText.textContent = `${t.title}: ${fmt(actualTotal)}h / ${fmt(plannedTotal)}h this week (${fmt(pct)}%) | ${fmt(trackedTotal)}h total tracked`;
  progressFill.style.width = `${pct}%`;
}

function startFocusTimer() {
  const t = state.tasks.find((x) => x.id === state.log_project_id);
  if (!t) return;
  if (state.active_timer) {
    const activeTaskExists = state.tasks.some((x) => x.id === state.active_timer.task_id);
    if (!activeTaskExists) state.active_timer = null;
  }
  const today = todayIso();
  const weekDays = currentWeekDatesMonFri();
  const idx = weekDays.findIndex((d) => d === today);
  startTimer(t.id, idx);
}

function pauseFocusTimer() {
  pauseActiveTimer(true);
}

function stopFocusTimer() {
  stopActiveTimer(true);
}

function renderFocusTimer() {
  const startBtn = document.getElementById("timerStartBtn");
  const pauseBtn = document.getElementById("timerPauseBtn");
  const stopBtn = document.getElementById("timerStopBtn");
  const badge = document.getElementById("timerStateBadge");
  const status = document.getElementById("timerStatusText");
  if (!startBtn || !pauseBtn || !stopBtn || !status || !badge) return;
  const hasFocus = Boolean(state.tasks.find((x) => x.id === state.log_project_id));
  const active = state.active_timer;
  const isRunning = Boolean(active && active.started_at);
  const isPaused = Boolean(active && !active.started_at);
  const sameFocus = Boolean(active && active.task_id === state.log_project_id);

  startBtn.disabled = !hasFocus || (isRunning && !sameFocus) || (isPaused && !sameFocus);
  pauseBtn.disabled = !isRunning;
  stopBtn.disabled = !active;

  if (!active) {
    badge.textContent = "STOPPED";
    badge.className = "timer-state timer-state-idle";
    status.textContent = hasFocus ? "Ready to track time." : "Select a focus project first.";
    return;
  }

  const timerTask = state.tasks.find((x) => x.id === active.task_id);
  if (!timerTask) {
    badge.textContent = "STOPPED";
    badge.className = "timer-state timer-state-idle";
    state.active_timer = null;
    status.textContent = hasFocus
      ? "Recovered from stale timer state. Press Start to begin for selected focus project."
      : "Select a focus project first.";
    scheduleSave();
    return;
  }
  const elapsed = currentElapsedMs(active);
  const name = timerTask ? timerTask.title : "Unknown project";
  if (isRunning) {
    badge.textContent = "RUNNING";
    badge.className = "timer-state timer-state-running";
  } else {
    badge.textContent = "PAUSED";
    badge.className = "timer-state timer-state-paused";
  }
  const started = parseIsoDate(active.started_at);
  const startedText = started ? `Started at ${toClockLocal(started)}` : "Paused";
  status.textContent = `${name} | ${formatElapsed(elapsed)} elapsed | ${startedText}`;
}

function render() {
  const rolled = autoAdvanceWeekIfNeeded();
  if (rolled) scheduleSave();

  const changed = refreshAutoDebt();
  if (changed) scheduleSave();

  renderWeekly();
  renderBudgets();
  renderKanbanDashboard();
  renderExecutionLog();
  renderFocusTimer();
  renderProjectProgress();

  if (timerTickHandle) {
    clearTimeout(timerTickHandle);
    timerTickHandle = null;
  }
  if (state.active_timer && state.active_timer.started_at) timerTickHandle = setTimeout(render, 1000);
}

window.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("addBtn").addEventListener("click", addProject);
  document.getElementById("exportJsonBtn").addEventListener("click", exportStateJson);
  document.getElementById("importJsonInput").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0] ? e.target.files[0] : null;
    await importStateJson(file);
    e.target.value = "";
  });
  document.getElementById("timerStartBtn").addEventListener("click", startFocusTimer);
  document.getElementById("timerPauseBtn").addEventListener("click", pauseFocusTimer);
  document.getElementById("timerStopBtn").addEventListener("click", stopFocusTimer);
  document.getElementById("saveEditBtn").addEventListener("click", saveEditor);
  document.getElementById("cancelEditBtn").addEventListener("click", closeEditor);
  await loadState();
});

window.addEventListener("beforeunload", () => {
  try { persistStateSync(false); } catch {}
});

window.addEventListener("pagehide", () => {
  try { persistStateSync(false); } catch {}
});

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    try { persistStateSync(false); } catch {}
  }
});

document.addEventListener("keydown", (e) => {
  const isSaveCombo = (e.metaKey || e.ctrlKey) && String(e.key).toLowerCase() === "s";
  if (!isSaveCombo) return;
  e.preventDefault();
  try {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    persistStateSync(true);
    mirrorStateToServer();
    setDataStatus("Forced local save completed (Cmd/Ctrl+S).", "good");
  } catch (err) {
    const msg = err && err.message ? err.message : "unknown";
    const el = document.getElementById("saveState");
    if (el) el.textContent = `Force save error: ${msg}`;
  }
});
