# Sample Board Setup

This setup matches the defaults defined in `README.md`:
- WIP limit: `Doing <= 1`
- `Ready <= 3` highest Burner scores
- Scoring model: `(Impact + Urgency) - Effort`
- Catch-up model: `Remaining Base Work + (Paused Weeks x Drift Rate) + Restart Overhead`

## 1) Board Columns

Create 4 columns:
1. `Backlog`
2. `Ready`
3. `Doing`
4. `Done`

## 2) Required Fields

Use all columns from `templates/tasks_template.csv`.

Minimum required for prioritization:
- `Impact`, `Urgency`, `Effort`, `Burner Score`

Minimum required for interruption planning:
- `Paused`, `Freeze Date`, `Drift Rate (hrs/week)`, `Restart Overhead (hrs)`, `Remaining Base Work (hrs)`, `Paused Weeks`, `Catch-up Hours`

## 3) Formula Setup (Notion/Trello/Airtable)

Implement formulas:

- `Burner Score = (Impact + Urgency) - Effort`
- `Catch-up Hours = Remaining Base Work + (Paused Weeks * Drift Rate) + Restart Overhead`

If your tool supports conditional formulas, set:
- `Paused Weeks = 0` when `Paused = no`

## 4) Views

Create these views:

1. `Execution View`
- Group by `Status`
- Filter out `Done`
- Sort by `Burner Score` descending

2. `Back Burner Queue`
- Filter `Paused = yes`
- Sort by `Catch-up Hours` descending

3. `This Week Focus`
- Filter `Status in (Ready, Doing)`
- Sort by `Status` then `Burner Score` descending

4. `At Risk Deadlines`
- Filter `Deadline within next 14 days`
- Add indicator: `Catch-up Hours > available hours`

## 5) Operating Routine

Daily:
- Move exactly one `Ready` item to `Doing` if `Doing` is empty.
- Update `Progress %` and `Next Step` on active item.

On interruption:
- Mark task `Paused = yes`
- Set `Freeze Date`
- Update `Paused Weeks`
- Compute `Catch-up Hours`
- Add a short `Deferral Risk Note`

Weekly:
- Re-score all non-done tasks.
- Keep only top 3 tasks in `Ready`.
- Review `Back Burner Queue` by highest `Catch-up Hours` first.

## 6) Default Policies

- Hard WIP limit of 1.
- No task larger than 2-3 working days.
- Blocked >48h goes from `Doing` to `Ready` with blocker note.
- Re-entry must be scheduled with explicit catch-up hours.
