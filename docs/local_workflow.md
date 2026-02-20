# Local Workflow (3 Decisions)

This tool now follows your exact decision order.

## 1) Decide Total Hours/Week

Set one number first: `Total Hours/Week`.

## 2) Allocate Across Responsibilities

Set weekly budgets for:
- `Research`
- `Teaching`
- `Service`
- `Admin`
- `Other`

Then assign each project an `Allocated h/wk`.

## 3) Prioritize Research Projects

For research projects, use two ratings:
- `Important` (1-5)
- `Urgent` (1-5)

Default policy:
- `Eat the Frog`: rank by `Important` first, then `Urgent`.
- Translation: a more important project always comes first, even if another one is more urgent.

If you choose an urgent project and defer an important one:
- Mark that deferred project as `Sacrificed`.
- The app tracks make-up debt hours over time.

## Run

```bash
python3 scripts/webapp.py
```

Open `http://127.0.0.1:8765`.

Memory:
- The app auto-saves to browser `localStorage`.
- `Cmd+S` / `Ctrl+S` forces an immediate local save.
- For cross-device use, export JSON from `0) Local Data + Backup` and import it on the other browser/device.
- `Export JSON` is always the latest state at the moment you click it.
- Pomodoro runs in `5) Focus Pomodoro + Progress`; the weekly log is record-only.
