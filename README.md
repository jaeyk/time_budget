# TimeBudget (Beta)

TimeBudget is a local browser tool for weekly time planning and project execution.

## Run

```bash
python3 scripts/webapp.py
```

Open `http://127.0.0.1:8765`.

## Deploy (GitHub Pages)

This repo includes a GitHub Actions workflow at `.github/workflows/deploy-pages.yml` that deploys the `web/` folder.

1. Push to `main`.
2. In GitHub repo settings, go to `Settings -> Pages`.
3. Set `Source` to `GitHub Actions`.
4. After the workflow runs, your site will be available at:
   - `https://<your-username>.github.io/<repo-name>/`
   - this repo: `https://jaeyk.github.io/time_budget/`

Notes:
- The app is static and local-first (`localStorage`), so data is saved per browser/device.
- Use `Export JSON` / `Import JSON` to move data across devices.

## Current Workflow

1. Set daily work capacity (Mon-Fri).
2. Set weekly budgets by responsibility (`Research`, `Teaching`, `Service`, `Admin`, `Other`).
3. Add projects with domain, impact, start date, and target end date.
4. Manage projects in Kanban (`Backlog`, `Ready`, `Doing`, `Done`) with drag-and-drop moves/reordering.
5. Use **Focus Timer + Progress** (`start`, `pause`, `stop`) for work sessions and progress bars.
6. Use **Weekly Execution Log** as the record view for planned/start/end/actual.

## Planning Logic

- Weekly project planning is driven by the **Research budget**.
- Research projects split that budget by user-defined `Research split (%)`.
- If all splits are unset (`0`), the focused project in the log gets the research budget by default.
- Planned hours are distributed across active weekdays based on each project's `start_date` and `deadline`.

## Weekly Log (Single Project Focus)

The log shows one selected project with daily rows (Mon-Fri):
- `Planned`
- `Start`
- `End`
- `Actual Spent`

Timer behavior now lives in a separate section:
- **Focus Timer + Progress** supports `start`, `pause`, and `stop`.
- Stopped sessions update today's log row for the selected focus project.
- Each project also stores cumulative tracked hours across weeks.
- If a timer references a removed/invalid project, the app clears the stale timer state automatically.

## Dashboard

Kanban cards support:
- move status
- edit metadata
- delete project

## Data Storage

- Primary store: browser `localStorage` (auto-save on edits and timer events).
- Force save shortcut: `Cmd+S` (Mac) or `Ctrl+S` (Windows/Linux) writes immediately to local storage.
- Export/Import: use **0) Local Data + Backup** in the app.
  - `Export JSON` always exports the latest in-memory state.
  - `Import JSON` restores state from a previous export.

Notes:
- `localStorage` is browser-specific. Different browser/device starts empty until you import JSON.
- When running the local Python server, saves are also mirrored to `data/state.json` for local relaunch consistency.

## Note

This is a beta version and may change quickly.
