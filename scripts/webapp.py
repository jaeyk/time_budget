#!/usr/bin/env python3
"""Lightweight local Kanban Burner web app server.

Run:
  python3 scripts/webapp.py
Then open:
  http://127.0.0.1:8765
"""

from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime, timezone
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import errno

ROOT = Path(__file__).resolve().parent.parent
WEB_DIR = ROOT / "web"
DATA_DIR = ROOT / "data"
STATE_PATH = DATA_DIR / "state.json"
CSV_PATH = DATA_DIR / "tasks.csv"

DEFAULT_STATE = {
    "budgets": {
        "Research": 15.0,
        "Teaching": 20.0,
        "Service": 5.0,
        "Admin": 3.0,
        "Other": 0.0,
    },
    "tasks": [],
    "updated_at": None,
}


def _to_float(value: str, default: float = 0.0) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _to_int(value: str, default: int = 0) -> int:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return default


def seed_from_csv(csv_path: Path) -> dict:
    if not csv_path.exists():
        return DEFAULT_STATE.copy()

    tasks = []
    with csv_path.open("r", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            tasks.append(
                {
                    "id": row.get("Task ID", ""),
                    "title": row.get("Title", ""),
                    "domain": row.get("Domain", "Research") or "Research",
                    "status": row.get("Status", "Backlog") or "Backlog",
                    "impact": _to_int(row.get("Impact", "0")),
                    "urgency": _to_int(row.get("Urgency", "0")),
                    "effort": _to_int(row.get("Effort", "0")),
                    "risk": _to_int(row.get("Risk", "0")),
                    "paused": (row.get("Paused", "").strip().lower() in {"yes", "true", "1", "y"}),
                    "freeze_date": row.get("Freeze Date", ""),
                    "progress_percent": _to_float(row.get("Progress %", "0")),
                    "next_step": row.get("Next Step", ""),
                    "drift_rate": _to_float(row.get("Drift Rate (hrs/week)", "0")),
                    "restart_overhead": _to_float(row.get("Restart Overhead (hrs)", "0")),
                    "remaining_base_work": _to_float(row.get("Remaining Base Work (hrs)", "0")),
                    "allocated_hours": _to_float(row.get("Allocated Hours/Week", "0")),
                    "deadline": row.get("Deadline", ""),
                    "deferral_note": row.get("Deferral Risk Note", ""),
                    "owner": row.get("Owner", ""),
                }
            )

    return {
        "budgets": DEFAULT_STATE["budgets"].copy(),
        "tasks": tasks,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }


def load_state() -> dict:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if STATE_PATH.exists():
        with STATE_PATH.open("r", encoding="utf-8") as f:
            return json.load(f)

    state = seed_from_csv(CSV_PATH)
    save_state(state)
    return state


def save_state(state: dict) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    state["updated_at"] = datetime.now(timezone.utc).isoformat()
    with STATE_PATH.open("w", encoding="utf-8") as f:
        json.dump(state, f, indent=2)


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, payload: dict, status: int = 200) -> None:
        data = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_text(self, text: str, status: int = 200, ctype: str = "text/plain; charset=utf-8") -> None:
        data = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self) -> None:
        if self.path == "/api/state":
            self._send_json(load_state())
            return

        if self.path == "/" or self.path == "/index.html":
            path = WEB_DIR / "index.html"
            if not path.exists():
                self._send_text("Missing web/index.html", status=HTTPStatus.NOT_FOUND)
                return
            self._send_text(path.read_text(encoding="utf-8"), ctype="text/html; charset=utf-8")
            return

        if self.path.startswith("/"):
            rel = self.path.lstrip("/")
            path = WEB_DIR / rel
            if path.exists() and path.is_file():
                if path.suffix == ".js":
                    ctype = "application/javascript; charset=utf-8"
                elif path.suffix == ".css":
                    ctype = "text/css; charset=utf-8"
                else:
                    ctype = "text/plain; charset=utf-8"
                self._send_text(path.read_text(encoding="utf-8"), ctype=ctype)
                return

        self._send_text("Not found", status=HTTPStatus.NOT_FOUND)

    def do_POST(self) -> None:
        if self.path != "/api/state":
            self._send_text("Not found", status=HTTPStatus.NOT_FOUND)
            return

        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        try:
            payload = json.loads(body.decode("utf-8"))
        except json.JSONDecodeError:
            self._send_json({"error": "invalid json"}, status=HTTPStatus.BAD_REQUEST)
            return

        if not isinstance(payload, dict) or "tasks" not in payload or "budgets" not in payload:
            self._send_json({"error": "payload must include budgets and tasks"}, status=HTTPStatus.BAD_REQUEST)
            return

        save_state(payload)
        self._send_json({"ok": True, "updated_at": payload.get("updated_at")})


def main() -> None:
    parser = argparse.ArgumentParser(description="Kanban Burner local web server")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    load_state()
    try:
        server = ThreadingHTTPServer((args.host, args.port), Handler)
    except OSError as e:
        if e.errno == errno.EADDRINUSE:
            server = ThreadingHTTPServer((args.host, 0), Handler)
            chosen_port = server.server_address[1]
            print(
                f"Port {args.port} is in use. Switched to random free port {chosen_port}."
            )
        else:
            raise

    host, port = server.server_address[:2]
    print(f"Serving on http://{host}:{port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
