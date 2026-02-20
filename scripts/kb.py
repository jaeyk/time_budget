#!/usr/bin/env python3
"""Local Kanban Burner CLI.

Usage:
  python3 scripts/kb.py recalc [--csv data/tasks.csv]
  python3 scripts/kb.py focus [--csv data/tasks.csv] [--limit 3]
"""

from __future__ import annotations

import argparse
import csv
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any


CSV_DEFAULT = Path("data/tasks.csv")
DATE_FMT = "%Y-%m-%d"


@dataclass
class Task:
    row: dict[str, str]

    def get_float(self, key: str, default: float = 0.0) -> float:
        raw = (self.row.get(key) or "").strip()
        if raw == "":
            return default
        try:
            return float(raw)
        except ValueError:
            return default

    def get_int(self, key: str, default: int = 0) -> int:
        raw = (self.row.get(key) or "").strip()
        if raw == "":
            return default
        try:
            return int(float(raw))
        except ValueError:
            return default

    def is_paused(self) -> bool:
        return (self.row.get("Paused", "").strip().lower() in {"yes", "y", "true", "1"})

    def get_date(self, key: str) -> date | None:
        raw = (self.row.get(key) or "").strip()
        if not raw:
            return None
        try:
            return date.fromisoformat(raw)
        except ValueError:
            return None


def paused_weeks(paused: bool, freeze_date: str, today: date) -> float:
    if not paused or not freeze_date:
        return 0.0
    try:
        freeze = date.fromisoformat(freeze_date)
    except ValueError:
        return 0.0
    days = max(0, (today - freeze).days)
    return round(days / 7.0, 2)


def recalc_task(task: Task, today: date) -> None:
    impact = task.get_int("Impact")
    urgency = task.get_int("Urgency")
    effort = task.get_int("Effort")

    burner_score = impact + urgency - effort
    task.row["Burner Score"] = str(burner_score)

    paused = task.is_paused()
    weeks = paused_weeks(paused, (task.row.get("Freeze Date") or "").strip(), today)
    task.row["Paused Weeks"] = f"{weeks:.2f}".rstrip("0").rstrip(".") if weeks else "0"

    drift_rate = task.get_float("Drift Rate (hrs/week)")
    restart_overhead = task.get_float("Restart Overhead (hrs)")
    remaining = task.get_float("Remaining Base Work (hrs)")

    catch_up = remaining + (weeks * drift_rate) + restart_overhead
    task.row["Catch-up Hours"] = f"{catch_up:.2f}".rstrip("0").rstrip(".")

    allocated_per_week = task.get_float("Allocated Hours/Week")
    deadline = task.get_date("Deadline")
    if deadline is None:
        required_per_week = 0.0
    else:
        days_left = (deadline - today).days
        if days_left <= 0:
            required_per_week = catch_up
        else:
            required_per_week = catch_up / (days_left / 7.0)

    allocation_gap = allocated_per_week - required_per_week
    task.row["Required Hours/Week"] = f"{required_per_week:.2f}".rstrip("0").rstrip(".")
    task.row["Allocation Gap (hrs/week)"] = f"{allocation_gap:.2f}".rstrip("0").rstrip(".")

    task.row["Updated At"] = today.isoformat()


def read_tasks(path: Path) -> tuple[list[dict[str, str]], list[Task]]:
    with path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        if reader.fieldnames is None:
            raise ValueError("CSV is missing a header row")
        rows = [dict(r) for r in reader]
        tasks = [Task(r) for r in rows]
        return reader.fieldnames, tasks


def write_tasks(path: Path, fieldnames: list[str], tasks: list[Task]) -> None:
    with path.open("w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for task in tasks:
            writer.writerow(task.row)


def cmd_recalc(args: argparse.Namespace) -> None:
    csv_path = Path(args.csv)
    fieldnames, tasks = read_tasks(csv_path)
    today = date.today()
    for task in tasks:
        recalc_task(task, today)
    write_tasks(csv_path, fieldnames, tasks)
    print(f"updated {len(tasks)} tasks in {csv_path}")


def status_rank(status: str) -> int:
    order = {"Doing": 0, "Ready": 1, "Backlog": 2, "Done": 3}
    return order.get(status, 99)


def focus_key(task: Task) -> tuple[Any, ...]:
    status = (task.row.get("Status") or "").strip()
    burner_score = task.get_float("Burner Score")
    urgency = task.get_float("Urgency")
    effort = task.get_float("Effort")
    allocation_gap = task.get_float("Allocation Gap (hrs/week)")
    return (status_rank(status), allocation_gap, -burner_score, -urgency, effort)


def cmd_focus(args: argparse.Namespace) -> None:
    csv_path = Path(args.csv)
    _, tasks = read_tasks(csv_path)

    candidates = []
    for task in tasks:
        status = (task.row.get("Status") or "").strip()
        if status == "Done":
            continue
        candidates.append(task)

    candidates.sort(key=focus_key)
    top = candidates[: args.limit]

    if not top:
        print("no active tasks")
        return

    print("Top focus tasks:")
    for idx, task in enumerate(top, start=1):
        r = task.row
        print(
            f"{idx}. [{r.get('Status','')}] {r.get('Task ID','')} {r.get('Title','')} "
            f"| score={r.get('Burner Score','')} | catchup={r.get('Catch-up Hours','')}h "
            f"| alloc_gap={r.get('Allocation Gap (hrs/week)','')}h/wk"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Kanban Burner local CLI")
    sub = parser.add_subparsers(dest="cmd", required=True)

    recalc = sub.add_parser("recalc", help="Recalculate computed fields in CSV")
    recalc.add_argument("--csv", default=str(CSV_DEFAULT), help="Path to tasks CSV")
    recalc.set_defaults(func=cmd_recalc)

    focus = sub.add_parser("focus", help="Show top focus candidates")
    focus.add_argument("--csv", default=str(CSV_DEFAULT), help="Path to tasks CSV")
    focus.add_argument("--limit", type=int, default=3, help="Number of tasks to show")
    focus.set_defaults(func=cmd_focus)

    return parser.parse_args()


def main() -> None:
    args = parse_args()
    args.func(args)


if __name__ == "__main__":
    main()
