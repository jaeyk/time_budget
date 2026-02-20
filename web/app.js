const DOMAINS = ["Research", "Teaching", "Service", "Admin", "Other"];
const IMPACT_LEVELS = ["High", "Medium", "Low"];
const IMPACT_WEIGHT = { High: 3, Medium: 2, Low: 1 };
const STATUSES = ["Backlog", "Ready", "Doing", "Done"];
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"];

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

function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
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
  };
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
  const res = await fetch("/api/state");
  state = await res.json();

  if (state.daily_hours == null) {
    const weekly = num(state.weekly_hours, 40);
    state.daily_hours = weekly / 5;
  } else {
    state.daily_hours = num(state.daily_hours, 8);
  }

  if (!state.budgets) state.budgets = {};
  if (!state.tasks) state.tasks = [];
  if (!state.active_timer) state.active_timer = null;
  if (state.log_project_id == null) state.log_project_id = null;
  if (!state.last_week_key) state.last_week_key = currentWeekKey();

  DOMAINS.forEach((d) => {
    if (state.budgets[d] == null) state.budgets[d] = 0;
  });

  state.tasks = state.tasks.map(normalizeTask);
  if (!state.log_project_id && state.tasks.length > 0) {
    state.log_project_id = state.tasks[0].id;
  } else if (state.log_project_id) {
    const exists = state.tasks.some((t) => t.id === state.log_project_id);
    if (!exists) state.log_project_id = state.tasks.length > 0 ? state.tasks[0].id : null;
  }

  render();
}

async function saveState() {
  const res = await fetch("/api/state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
  const out = await res.json();
  const el = document.getElementById("saveState");
  el.textContent = out.ok ? `Saved ${new Date().toLocaleTimeString()}` : `Save error: ${out.error || "unknown"}`;
}

function scheduleSave() {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(saveState, 250);
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

    const items = state.tasks
      .filter((t) => t.status === status)
      .sort((a, b) => a.title.localeCompare(b.title));

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
        card.innerHTML = `<strong>${t.title}</strong><br/><span class="muted">${t.domain} | ${t.impact} impact | ${urgency} pressure${splitTxt}</span>${debt > 0 ? `<br/><span class="bad">Debt: ${fmt(debt)}h</span>` : ""}`;

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
          scheduleSave();
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
  const today = todayIso();

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
    renderExecutionLog();
    scheduleSave();
  };

  const progressText = document.getElementById("logProgressText");
  const progressFill = document.getElementById("logProgressFill");
  const t = state.tasks.find((x) => x.id === state.log_project_id) || null;
  if (!t) {
    progressText.textContent = "No project selected.";
    progressFill.style.width = "0%";
    return;
  }

  const plannedTotal = weeklyPlannedTotal(t);
  const actualTotal = weeklyActualTotal(t);
  const pct = plannedTotal <= 0 ? 0 : Math.min(100, (actualTotal / plannedTotal) * 100);
  progressText.textContent = `${t.title}: ${fmt(actualTotal)}h / ${fmt(plannedTotal)}h (${fmt(pct)}%)`;
  progressFill.style.width = `${pct}%`;

  for (let i = 0; i < WEEKDAYS.length; i += 1) {
    const dayIso = weekDays[i];
    const isPastDay = dayIso < today;

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

    const actTd = document.createElement("td");
    const info = document.createElement("div");
    info.className = "timer-info";

    const btn = document.createElement("button");
    btn.className = "timer-btn";

    const runningHere = Boolean(
      state.active_timer &&
      state.active_timer.task_id === t.id &&
      state.active_timer.day_index === i
    );

    if (runningHere) {
      btn.textContent = "Stop";
      btn.addEventListener("click", () => stopActiveTimer());
      const started = parseIsoDate(state.active_timer.started_at);
      if (started) info.textContent = `Running: ${formatElapsed(Date.now() - started.getTime())}`;
    } else if (isPastDay) {
      btn.textContent = "Locked";
      btn.disabled = true;
      btn.classList.add("actual-locked");
      info.textContent = "Past day";
    } else if (dayIso > today) {
      btn.textContent = "Not Yet";
      btn.disabled = true;
      info.textContent = "Future day";
    } else if (state.active_timer) {
      btn.textContent = "Busy";
      btn.disabled = true;
      info.textContent = "Another timer running";
    } else {
      btn.textContent = "Start";
      btn.addEventListener("click", () => startTimer(t.id, i));
    }

    actTd.appendChild(info);
    actTd.appendChild(btn);

    [dayTd, planTd, startTd, endTd, actualTd, actTd].forEach((td) => tr.appendChild(td));
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
  });
  state.tasks.push(task);

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
  if (state.active_timer) return;
  const t = state.tasks.find((x) => x.id === taskId);
  if (!t) return;
  const now = new Date();
  t.daily_start[dayIndex] = toClockLocal(now);
  state.active_timer = { task_id: taskId, day_index: dayIndex, started_at: now.toISOString() };
  render();
  scheduleSave();
}

function stopActiveTimer(renderAfter = true) {
  if (!state.active_timer) return;
  const t = state.tasks.find((x) => x.id === state.active_timer.task_id);
  const idx = num(state.active_timer.day_index, -1);
  const started = parseIsoDate(state.active_timer.started_at);
  if (t && idx >= 0 && idx < 5 && started) {
    const now = new Date();
    const elapsedHours = Math.max(0, (now.getTime() - started.getTime()) / (1000 * 60 * 60));
    t.daily_actual[idx] = Math.max(0, num(t.daily_actual[idx], 0) + elapsedHours);
    t.daily_end[idx] = toClockLocal(now);
  }
  state.active_timer = null;
  if (renderAfter) render();
  scheduleSave();
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

  if (timerTickHandle) {
    clearTimeout(timerTickHandle);
    timerTickHandle = null;
  }
  if (state.active_timer) timerTickHandle = setTimeout(render, 1000);
}

window.addEventListener("DOMContentLoaded", async () => {
  document.getElementById("addBtn").addEventListener("click", addProject);
  document.getElementById("saveEditBtn").addEventListener("click", saveEditor);
  document.getElementById("cancelEditBtn").addEventListener("click", closeEditor);
  await loadState();
});
